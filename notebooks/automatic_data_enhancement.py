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
    args = ap.parse_args()

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
    with args.output.open("a", encoding="utf-8") as out_f:
        for i, entry in enumerate(iter_jsonl(args.input), 1):
            if args.limit and n_total >= args.limit:
                break
            key = entry.get("identifier") or entry.get("pdf_url")
            if key and key in skip_keys:
                continue

            n_total += 1
            print(f"\n[{n_total}] entry #{i}")
            result = process_entry(
                entry,
                summarizer=summarizer,
                cache_dir=args.cache_dir,
                pages_to_summarize=args.pages,
                output_language=output_language,
            )
            out_f.write(json.dumps(result, ensure_ascii=False) + "\n")
            out_f.flush()   # so you can tail -f the output file

            if result.get("status") == "ok":
                n_ok += 1
                print(f"    ✓ done in {result.get('summary_seconds')}s")
            else:
                n_err += 1
                print(f"    ✗ {result.get('error')}")

    print(f"\nFinished. {n_ok} ok, {n_err} errors, {n_total} total.")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()