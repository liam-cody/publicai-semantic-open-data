#!/usr/bin/env python3
"""
Batch-summarize German PDFs listed in a JSONL file.

Each line in the input JSONL must be a JSON object with at least a
`pdf_url` field. Other fields (title, description, identifier, ...) are
preserved and copied into the output.

Example input line:
    {"title": "Nationalpark kommt in die Schule",
     "description": "IFAU",
     "pdf_url": "https://wissensdatenbank.kalkalpen.at/Download.ashx?key=8073",
     "source_line": 35316,
     "identifier": "D75BDB81-1DE3-56B9-9C50-BED351A1B191"}

USAGE
-----
    # Summarize every entry, write JSONL output, cache PDFs in ./pdf_cache
    python batch_summarize_jsonl.py docs.jsonl -o summaries.jsonl

    # Test run on the first 5 entries
    python batch_summarize_jsonl.py docs.jsonl -o summaries.jsonl --limit 5

    # 4-bit Qwen for a 24 GB GPU
    python batch_summarize_jsonl.py docs.jsonl -o summaries.jsonl --load-in-4bit

    # Skip entries already present in the output (resume an interrupted run)
    python batch_summarize_jsonl.py docs.jsonl -o summaries.jsonl --resume

REQUIREMENTS
------------
    pip install pypdf requests "transformers>=4.51" "torch>=2.1" accelerate
    # Optional, for 4-bit quantization:
    pip install bitsandbytes
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Iterator

import requests
from pypdf import PdfReader

# --- Same heuristics as the single-file version ----------------------------

INTRO_HEADINGS = [
    r"\bEinleitung\b",
    r"\bEinf[üu]hrung\b",
    r"\bVorwort\b",
    r"\bZusammenfassung\b",
    r"\bAbstract\b",
    r"\b1\.\s*Einleitung\b",
    r"\b1\s+Einleitung\b",
    r"\bKapitel\s*1\b",
]

FRONTMATTER_MARKERS = [
    r"Inhaltsverzeichnis",
    r"Impressum",
    r"Vorwort",
    r"Copyright",
    r"ISBN",
    r"\.{5,}",
]

SKIP_TITLES = []
# ---------------------------------------------------------------------------
# JSONL I/O
# ---------------------------------------------------------------------------

def iter_jsonl(path: Path) -> Iterator[dict]:
    """Yield JSON objects from a JSONL file, skipping blank/invalid lines."""
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as e:
                print(f"  ! line {line_no}: invalid JSON ({e}), skipping",
                      file=sys.stderr)


def already_done(output_path: Path) -> set[str]:
    """Return the set of identifiers (or URLs) already in the output file."""
    done: set[str] = set()
    if not output_path.exists():
        return done
    with output_path.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = obj.get("identifier") or obj.get("pdf_url")
            if key:
                done.add(key)
    return done


# ---------------------------------------------------------------------------
# PDF download with caching
# ---------------------------------------------------------------------------

def download_pdf(url: str, cache_dir: Path, timeout: int = 60) -> Path | None:
    """
    Download a PDF to cache_dir, named by URL hash. Returns the local path
    or None on failure. Re-uses existing cached files.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    # Use a hash of the URL as the filename — URLs can contain query strings,
    # special chars, and aren't always safe as paths.
    url_hash = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    local = cache_dir / f"{url_hash}.pdf"

    if local.exists() and local.stat().st_size > 0:
        return local

    try:
        with requests.get(url, stream=True, timeout=timeout,
                          headers={"User-Agent": "Mozilla/5.0"}) as r:
            r.raise_for_status()
            ctype = r.headers.get("Content-Type", "").lower()
            # Some servers don't send the right content-type; be lenient.
            if "pdf" not in ctype and not url.lower().endswith(".pdf"):
                print(f"    ? content-type is {ctype!r}, downloading anyway")
            with local.open("wb") as f:
                for chunk in r.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        f.write(chunk)
    except Exception as e:
        print(f"    ! download failed: {e}", file=sys.stderr)
        if local.exists():
            local.unlink()
        return None

    if local.stat().st_size == 0:
        local.unlink()
        return None
    return local


# ---------------------------------------------------------------------------
# PDF text extraction (same as before)
# ---------------------------------------------------------------------------

def extract_pages(pdf_path: Path) -> list[str]:
    try:
        reader = PdfReader(str(pdf_path))
    except Exception as e:
        print(f"    ! cannot open PDF: {e}", file=sys.stderr)
        return []
    pages = []
    for p in reader.pages:
        try:
            pages.append(p.extract_text() or "")
        except Exception:
            pages.append("")
    return pages


def find_intro_page(pages: list[str], scan_limit: int = 20) -> int:
    limit = min(scan_limit, len(pages))
    for i in range(limit):
        text = pages[i]
        if not text.strip():
            continue
        for pattern in INTRO_HEADINGS:
            if re.search(pattern, text, re.IGNORECASE):
                if len(text) > 600 and not re.search(r"\.{5,}", text):
                    return i
    last_frontmatter = -1
    for i in range(limit):
        text = pages[i]
        if any(re.search(p, text, re.IGNORECASE) for p in FRONTMATTER_MARKERS):
            last_frontmatter = i
    if last_frontmatter >= 0 and last_frontmatter + 1 < len(pages):
        return last_frontmatter + 1
    return 0


def slice_pages(pages: list[str], start: int, count: int) -> tuple[str, int, int]:
    end = min(start + count, len(pages))
    chunk = "\n\n--- [Seitenumbruch] ---\n\n".join(
        pages[i].strip() for i in range(start, end) if pages[i].strip()
    )
    return chunk, start + 1, end


# ---------------------------------------------------------------------------
# Qwen3 loader & summarizer
# ---------------------------------------------------------------------------

class QwenSummarizer:
    """Loads Qwen3 once and reuses it across many PDFs."""

    def __init__(
        self,
        model_id: str = "Qwen/Qwen3-30B-A3B-Instruct-2507",
        device: str = "auto",
        load_in_4bit: bool = False,
        max_new_tokens: int = 1024,
    ):
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer
        except ImportError:
            sys.exit(
                "Please install transformers and torch:\n"
                "  pip install 'transformers>=4.51' 'torch>=2.1' accelerate"
            )
        self.torch = torch
        self.max_new_tokens = max_new_tokens

        print(f"Loading tokenizer: {model_id}")
        self.tokenizer = AutoTokenizer.from_pretrained(
            model_id, trust_remote_code=True)

        kwargs: dict = {"trust_remote_code": True}
        if load_in_4bit:
            try:
                from transformers import BitsAndBytesConfig
            except ImportError:
                sys.exit("4-bit needs bitsandbytes:  pip install bitsandbytes")
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
            )
            kwargs["device_map"] = "auto"
            print("Loading Qwen3 in 4-bit (NF4) ...")
        else:
            kwargs["torch_dtype"] = "auto"
            if device == "auto":
                kwargs["device_map"] = "auto"
            print("Loading Qwen3 in full precision ...")

        self.model = AutoModelForCausalLM.from_pretrained(model_id, **kwargs)
        if not load_in_4bit and device != "auto":
            self.model = self.model.to(device)
        self.model.eval()
        print("Model ready.\n")

    def summarize(self, text: str, output_language: str = "de") -> str:
        if output_language == "de":
            system = (
                "Du bist ein präziser Assistent für die Zusammenfassung "
                "deutschsprachiger Fachtexte. Antworte ausschließlich auf "
                "Deutsch. Behalte Fachbegriffe bei und erfinde keine Fakten."
            )
            user = (
                "Fasse den folgenden Auszug aus einem deutschsprachigen "
                "Dokument in 5–8 Sätzen zusammen. Konzentriere dich auf:\n"
                "  - das Thema und die zentrale Fragestellung,\n"
                "  - die wichtigsten Aussagen oder Argumente,\n"
                "  - relevante Begriffe oder Konzepte.\n"
                f"--- TEXT ---\n{text}\n--- ENDE ---"
            )
        else:
            system = (
                "You summarize German-language documents accurately into "
                "English. Preserve technical terms. Do not invent facts."
            )
            user = (
                "Summarize the following excerpt from a German document in "
                "5–8 sentences, then list 3–5 bullet-point takeaways.\n\n"
                f"--- TEXT ---\n{text}\n--- END ---"
            )

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        prompt = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True)
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
        input_len = inputs.input_ids.shape[1]

        with self.torch.no_grad():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=True,
                temperature=0.3,
                top_p=0.9,
                repetition_penalty=1.05,
                pad_token_id=self.tokenizer.eos_token_id,
            )
        generated = output_ids[0][input_len:]
        return self.tokenizer.decode(generated, skip_special_tokens=True).strip()

    def keywords(
            self,
            text: str,
            num_keywords: int = 6,
            output_language: str = "de",
        ) -> list[str]:
            """
            Generate a flat list of keywords/tags from a piece of text.
            Returns a Python list of strings (already parsed from the model's
            comma-separated output).
    
            num_keywords is treated as a *target*; the model is asked for a
            5–8 range to give it some flexibility, then the result is trimmed
            if it overshoots significantly.
            """
            # Translate the target into a sensible range for the prompt.
            lo = max(1, num_keywords - 2)
            hi = num_keywords + 2
    
            if output_language == "de":
                system = (
                    "Du extrahierst prägnante Schlagwörter aus deutschsprachigen "
                    "Texten. Gib ausschließlich die Schlagwörter aus, "
                    "kommagetrennt, ohne Nummerierung, ohne Erklärung, ohne "
                    "Anführungszeichen. Behalte deutsche Fachbegriffe bei."
                )
                user = (
                    f"Extrahiere {lo}–{hi} aussagekräftige Schlagwörter "
                    f"aus dem folgenden Text. Bevorzuge konkrete Substantive, "
                    f"Eigennamen und Fachbegriffe. Vermeide Füllwörter und "
                    f"Wiederholungen.\n\n"
                    f"--- TEXT ---\n{text}\n--- ENDE ---\n\n"
                    f"Schlagwörter (kommagetrennt):"
                )
            else:
                system = (
                    "You extract concise keywords from text. Output only the "
                    "keywords, comma-separated, no numbering, no explanation, "
                    "no quotes."
                )
                user = (
                    f"Extract {lo}–{hi} meaningful keywords from "
                    f"the following text. Prefer concrete nouns, proper names, "
                    f"and domain terms. Avoid filler words and repetition.\n\n"
                    f"--- TEXT ---\n{text}\n--- END ---\n\n"
                    f"Keywords (comma-separated):"
                )
    
            messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
            prompt = self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True)
            inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
            input_len = inputs.input_ids.shape[1]
    
            with self.torch.no_grad():
                output_ids = self.model.generate(
                    **inputs,
                    max_new_tokens=200,    # keywords are short — no need for 1024
                    do_sample=True,
                    temperature=0.2,       # even lower than summarization
                    top_p=0.9,
                    repetition_penalty=1.1,
                    pad_token_id=self.tokenizer.eos_token_id,
                )
            generated = output_ids[0][input_len:]
            raw = self.tokenizer.decode(generated, skip_special_tokens=True).strip()
            parsed = _parse_keywords(raw)
            # Trim if the model overshot (sometimes happens with low temperature
            # plus strong examples) — keep the first hi entries.
            return parsed[:hi]


def _parse_keywords(raw: str) -> list[str]:
    """
    Robustly parse a model's keyword output into a clean list.
    Handles: comma-separated, newline-separated, numbered lists, bullet
    lists, and stray quotes. Deduplicates while preserving order.
    """
    if not raw:
        return []
    # Strip a leading "Schlagwörter:" / "Keywords:" preamble if present.
    raw = re.sub(r"^\s*(Schlagw[öo]rter|Keywords)\s*[:\-]\s*", "",
                 raw, flags=re.IGNORECASE)
    # Split on commas, newlines, or semicolons.
    parts = re.split(r"[,;\n]+", raw)
    keywords: list[str] = []
    seen: set[str] = set()
    for part in parts:
        # Drop list markers like "1.", "2)", "- ", "* ".
        part = re.sub(r"^\s*(\d+[.)]|\-|\*|•)\s*", "", part)
        # Drop wrapping quotes.
        part = part.strip().strip("\"'`")
        if not part:
            continue
        key = part.lower()
        if key in seen:
            continue
        seen.add(key)
        keywords.append(part)
    return keywords

def process_entry(
    entry: dict,
    summarizer: QwenSummarizer,
    cache_dir: Path,
    pages_to_summarize: int,
    output_language: str,
) -> dict:
    """Download, extract, summarize one entry. Always returns a dict."""
    out = dict(entry)  
    url = entry.get("pdf_url")
    if not url:
        out["status"] = "error"
        out["error"] = "no pdf_url"
        return out

    title = entry.get("title", "(untitled)")
    print(f"  → {title[:70]}")
    print(f"    {url}")

    pdf_path = download_pdf(url, cache_dir)
    if pdf_path is None:
        out["status"] = "error"
        out["error"] = "download failed"
        return out

    pages = extract_pages(pdf_path)
    if not pages:
        out["status"] = "error"
        out["error"] = "could not read PDF"
        return out
    out["page_count"] = len(pages)

    start_idx = find_intro_page(pages)
    text, p1, p2 = slice_pages(pages, start_idx, pages_to_summarize)
    if not text.strip():
        out["status"] = "error"
        out["error"] = "no extractable text (likely scanned PDF)"
        return out
    out["summary_pages"] = [p1, p2]
    out["summary_chars"] = len(text)

    print(f"    Summarizing pages {p1}–{p2} ({len(text):,} chars) ...")
    t0 = time.time()
    try:
        summary = summarizer.summarize(text, output_language=output_language)
    except Exception as e:
        out["status"] = "error"
        out["error"] = f"generation failed: {e}"
        return out
    out["summary"] = summary
    out["summary_seconds"] = round(time.time() - t0, 1)
    out["status"] = "ok"
    return out

def process_entry_keywords(
    entry: dict,
    summarizer: QwenSummarizer,
    source_fields: list[str],
    num_keywords: int,
    output_language: str,
) -> dict:
    """
    Generate keywords from one or more existing text fields. The fields
    listed in `source_fields` are concatenated (in order, separated by
    newlines) — empty/missing fields are silently skipped.
    """
    out = dict(entry)
    title = entry.get("title", "(untitled)")
    print(f"  → {title[:70]}")

    pieces: list[str] = []
    used_fields: list[str] = []
    for field in source_fields:
        candidate = entry.get(field)
        if candidate and str(candidate).strip():
            pieces.append(str(candidate).strip())
            used_fields.append(field)

    # Last-resort fallback so we never feed an empty prompt to the model.
    if not pieces:
        for fallback in ("summary", "description", "title"):
            if fallback in source_fields:
                continue
            candidate = entry.get(fallback)
            if candidate and str(candidate).strip():
                pieces.append(str(candidate).strip())
                used_fields.append(fallback)
                break

    if not pieces:
        out["status"] = "error"
        out["error"] = "no text in any of: " + ", ".join(source_fields)
        return out

    text = "\n\n".join(pieces)

    print(f"    Generating ~{num_keywords} keywords from "
          f"{'+'.join(used_fields)} ({len(text):,} chars) ...")
    t0 = time.time()
    try:
        kws = summarizer.keywords(
            text,
            num_keywords=num_keywords,
            output_language=output_language,
        )
    except Exception as e:
        out["status"] = "error"
        out["error"] = f"generation failed: {e}"
        return out

    out["keywords"] = kws
    out["keywords_source_fields"] = used_fields
    out["keywords_seconds"] = round(time.time() - t0, 1)
    out["status"] = "ok"
    return out


def _normalized_skip_set() -> set[str]:
    """Return SKIP_TITLES normalized for case-insensitive comparison."""
    return {t.strip().lower() for t in SKIP_TITLES if t.strip()}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("input", type=Path, help="Input JSONL file.")
    ap.add_argument("-o", "--output", type=Path, required=True,
                    help="Output JSONL file (appends one summary per line).")
    ap.add_argument("--cache-dir", type=Path, default=Path("./pdf_cache"),
                    help="Where to cache downloaded PDFs (default: ./pdf_cache).")
    ap.add_argument("--limit", type=int, default=None,
                    help="Process at most N entries (useful for testing).")
    ap.add_argument("--pages", type=int, default=3,
                    help="How many pages to summarize per PDF (default: 3).")
    ap.add_argument("--resume", action="store_true",
                    help="Skip entries whose identifier/url is already in "
                         "the output file.")
    ap.add_argument("--model", default="Qwen/Qwen3-30B-A3B-Instruct-2507",
                    help="Hugging Face model ID.")
    ap.add_argument("--device", default="auto",
                    choices=["auto", "cuda", "cpu", "mps"])
    ap.add_argument("--load-in-4bit", action="store_true",
                    help="Quantize Qwen3 to 4-bit (fits on a 24 GB GPU).")
    ap.add_argument("--max-new-tokens", type=int, default=1024)
    ap.add_argument("--english", action="store_true",
                    help="Output summaries in English.")
    ap.add_argument("--mode", choices=["summarize", "keywords"],
                    default="summarize",
                    help="What to do with each entry: 'summarize' downloads "
                         "the PDF and writes a summary; 'keywords' reads an "
                         "existing text field and writes a keywords list.")
    ap.add_argument("--source-field", action="append", default=None,
                    metavar="FIELD",
                    help="(keywords mode) JSON field(s) to read text from. "
                         "Repeat to concatenate multiple fields. "
                         "Default: --source-field summary --source-field "
                         "description.")
    ap.add_argument("--num-keywords", type=int, default=6,
                    help="(keywords mode) Target keyword count "
                         "(model is asked for n-2 to n+2; default: 6, "
                         "giving a 4–8 range).")
    ap.add_argument("--require-field", metavar="FIELD", default=None,
                    help="Only process entries that already have this field "
                         "(e.g. --require-field summary to skip entries "
                         "without a summary).")
    ap.add_argument("--skip-if-has-field", metavar="FIELD", default=None,
                    help="Skip entries that already have this field "
                         "(e.g. --skip-if-has-field keywords to avoid "
                         "re-generating keywords).")
    ap.add_argument("--update-in-place", action="store_true",
                    help="Read all entries into memory, update matching ones, "
                         "then rewrite the output file. Use when input == "
                         "output to avoid creating duplicate records.")

    args = ap.parse_args()

    if args.source_field is None:
        args.source_field = ["summary", "description"]

    if not args.input.exists():
        sys.exit(f"Input not found: {args.input}")

    skip_keys = already_done(args.output) if args.resume else set()
    if skip_keys:
        print(f"Resume mode: {len(skip_keys)} entries already done, will skip.")

    summarizer = QwenSummarizer(
        model_id=args.model,
        device=args.device,
        load_in_4bit=True,
        max_new_tokens=args.max_new_tokens,
    )

    output_language = "en" if args.english else "de"

    n_total = 0
    n_ok = 0
    n_err = 0

    def _should_skip(entry: dict) -> bool:
        key = entry.get("identifier") or entry.get("pdf_url")
        if key and key in skip_keys:
            return True
        if args.require_field and not entry.get(args.require_field):
            return True
        if args.skip_if_has_field and entry.get(args.skip_if_has_field):
            return True
        return False

    def _run_entry(entry: dict) -> tuple[dict, str]:
        if args.mode == "summarize":
            return process_entry(
                entry, summarizer=summarizer, cache_dir=args.cache_dir,
                pages_to_summarize=args.pages, output_language=output_language,
            ), "summary_seconds"
        else:
            return process_entry_keywords(
                entry, summarizer=summarizer, source_fields=args.source_field,
                num_keywords=args.num_keywords, output_language=output_language,
            ), "keywords_seconds"

    if args.update_in_place:
        all_entries = list(iter_jsonl(args.input))
        for i, entry in enumerate(all_entries):
            if args.limit and n_total >= args.limit:
                break
            if _should_skip(entry):
                continue
            n_total += 1
            print(f"\n[{n_total}] entry #{i + 1} / {len(all_entries)}")
            result, duration_field = _run_entry(entry)
            all_entries[i] = result
            if result.get("status") == "ok":
                n_ok += 1
                print(f"    ✓ done in {result.get(duration_field)}s")
            else:
                n_err += 1
                print(f"    ✗ {result.get('error')}")
        with args.output.open("w", encoding="utf-8") as out_f:
            for record in all_entries:
                out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
    else:
        with args.output.open("a", encoding="utf-8") as out_f:
            for i, entry in enumerate(iter_jsonl(args.input), 1):
                if args.limit and n_total >= args.limit:
                    break
                if _should_skip(entry):
                    continue
                n_total += 1
                print(f"\n[{n_total}] entry #{i}")
                result, duration_field = _run_entry(entry)
                out_f.write(json.dumps(result, ensure_ascii=False) + "\n")
                out_f.flush()
                if result.get("status") == "ok":
                    n_ok += 1
                    print(f"    ✓ done in {result.get(duration_field)}s")
                else:
                    n_err += 1
                    print(f"    ✗ {result.get('error')}")

    print(f"\nFinished. {n_ok} ok, {n_err} errors, {n_total} processed.")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()