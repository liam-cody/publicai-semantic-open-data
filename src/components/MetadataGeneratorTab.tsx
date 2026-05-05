import { useState, useRef, useCallback, type CSSProperties, type DragEvent } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { getNebiusConfig } from '../lib/nebius'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'upload' | 'extracting' | 'analyzing' | 'done' | 'error'

interface LLMMetadata {
  title_de: string | null
  title_en: string | null
  description_de: string | null
  description_en: string | null
  keywords: string[] | null
  categories: string[] | null
  geographic_toponym: string | null
  begin_datetime: string | null
  end_datetime: string | null
}

// ─── OGD Austria category taxonomy ───────────────────────────────────────────

const OGD_CATEGORIES = [
  'Bevölkerung und Gesellschaft',
  'Bildung Kultur und Sport',
  'Energie',
  'Gesundheit',
  'Justiz Rechtssystem und öffentliche Sicherheit',
  'Landwirtschaft Fischerei Forstwirtschaft und Nahrungsmittel',
  'Regierung und öffentlicher Sektor',
  'Regionen und Städte',
  'Umwelt',
  'Verkehr',
  'Wirtschaft und Finanzen',
  'Wissenschaft und Technologie',
]

// ─── PDF text extraction ──────────────────────────────────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ')
    pages.push(pageText)
  }
  return pages.join('\n\n')
}

// ─── LLM metadata extraction ──────────────────────────────────────────────────

async function analyzePdfWithLLM(text: string): Promise<LLMMetadata> {
  const cfg = getNebiusConfig()
  if (!cfg.apiKey.trim()) {
    throw new Error('Missing Nebius API key — check VITE_NEBIUS_API_KEY in your .env file')
  }

  const systemPrompt = `You are a metadata assistant for the Austrian Open Government Data portal (data.gv.at).
Given text extracted from a PDF document, return a JSON object with exactly these fields (use null for fields you cannot determine from the text):
{
  "title_de": "German title of the document or dataset — infer one if not explicit",
  "title_en": "English translation of the title",
  "description_de": "German description in 2–4 sentences summarising the content",
  "description_en": "English description in 2–4 sentences summarising the content",
  "keywords": ["5 to 10 relevant German-language keywords as an array"],
  "categories": ["one or more values from the OGD Austria taxonomy listed below"],
  "geographic_toponym": "geographic area covered e.g. Wien, Österreich, Steiermark — or null",
  "begin_datetime": "ISO 8601 start date of temporal coverage if mentioned e.g. 2020-01-01 — or null",
  "end_datetime": "ISO 8601 end date of temporal coverage if mentioned — or null"
}
OGD Austria category taxonomy — use ONLY values from this list: ${OGD_CATEGORIES.join('; ')}.
Respond with valid JSON only — no markdown fences, no preamble, no trailing text.`

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.chatModel,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Extract metadata from this PDF text:\n\n${text.slice(0, 6000)}`,
        },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
    const msg = (err as { error?: { message?: string } })?.error?.message ?? res.statusText
    throw new Error(`Nebius error: ${msg}`)
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content ?? ''
  const clean = raw.replace(/```(?:json)?|```/g, '').trim()

  try {
    return JSON.parse(clean) as LLMMetadata
  } catch {
    throw new Error(
      `Could not parse LLM response as JSON.\n\nRaw response:\n${raw.slice(0, 500)}`
    )
  }
}

// ─── Field card helpers ───────────────────────────────────────────────────────

function renderValue(v: string | string[] | null | undefined): string {
  if (v == null || v === '') return ''
  if (Array.isArray(v)) return v.join(', ')
  return v
}

function AutoFieldCard({
  id,
  label,
  shortName,
  dcatProp,
  mandatory,
  value,
}: {
  id: number
  label: string
  shortName: string
  dcatProp: string
  mandatory: boolean
  value: string | string[] | null | undefined
}) {
  const displayVal = renderValue(value)
  const filled = displayVal.length > 0
  return (
    <div style={s.fieldCard}>
      <div style={s.fieldHeader}>
        <span style={s.fieldId}>#{id}</span>
        <span style={s.fieldLabel}>{label}</span>
        {mandatory && <span style={s.mandatoryBadge}>mandatory</span>}
        <span style={filled ? s.filledBadge : s.partialBadge}>
          {filled ? 'populated' : 'not detected'}
        </span>
      </div>
      <div style={s.fieldMeta}>
        <span style={s.fieldShortName}>{shortName}</span>
        <span style={s.fieldDcat}>{dcatProp}</span>
      </div>
      <div style={filled ? s.fieldValue : s.fieldEmpty}>
        {filled ? displayVal : 'Could not be extracted from the document text.'}
      </div>
    </div>
  )
}

function ManualFieldCard({
  id,
  label,
  shortName,
  dcatProp,
  mandatory,
  note,
}: {
  id: number
  label: string
  shortName: string
  dcatProp: string
  mandatory: boolean
  note: string
}) {
  return (
    <div style={{ ...s.fieldCard, ...s.fieldCardManual }}>
      <div style={s.fieldHeader}>
        <span style={s.fieldId}>#{id}</span>
        <span style={s.fieldLabel}>{label}</span>
        {mandatory && <span style={s.mandatoryBadge}>mandatory</span>}
        <span style={s.manualBadge}>manual input required</span>
      </div>
      <div style={s.fieldMeta}>
        <span style={s.fieldShortName}>{shortName}</span>
        <span style={s.fieldDcat}>{dcatProp}</span>
      </div>
      <div style={s.fieldNote}>{note}</div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MetadataGeneratorTab() {
  const [phase, setPhase] = useState<Phase>('upload')
  const [isDragOver, setIsDragOver] = useState(false)
  const [fileName, setFileName] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [llmMeta, setLlmMeta] = useState<LLMMetadata | null>(null)
  const [metadataId, setMetadataId] = useState('')
  const [today] = useState(() => new Date().toISOString().split('T')[0])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setError('Only PDF files are supported. Please upload a .pdf file.')
        setPhase('error')
        return
      }

      setFileName(file.name)
      setError(null)
      setLlmMeta(null)
      setCopied(false)

      setPhase('extracting')
      setStatusMsg('Extracting text from PDF…')

      let text: string
      try {
        text = await extractPdfText(file)
      } catch (e) {
        setError(`PDF extraction failed: ${e instanceof Error ? e.message : String(e)}`)
        setPhase('error')
        return
      }

      if (!text.trim()) {
        setError(
          'No readable text found in this PDF. It may be a scanned image without OCR text layer.'
        )
        setPhase('error')
        return
      }

      setPhase('analyzing')
      setStatusMsg('Analysing content with Nebius LLM…')

      try {
        const meta = await analyzePdfWithLLM(text)
        setLlmMeta(meta)
        setMetadataId(crypto.randomUUID())
        setPhase('done')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    },
    []
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) processFile(file)
    },
    [processFile]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) processFile(file)
      e.target.value = ''
    },
    [processFile]
  )

  const handleReset = useCallback(() => {
    setPhase('upload')
    setFileName('')
    setLlmMeta(null)
    setError(null)
    setCopied(false)
    setStatusMsg('')
  }, [])

  const handleCopyJson = useCallback(() => {
    if (!llmMeta) return
    const output = {
      // --- Core mandatory ---
      metadata_identifier: metadataId,
      metadata_modified: today,
      title: llmMeta.title_de ?? '',
      description: llmMeta.description_de ?? '',
      categorization: llmMeta.categories ?? [],
      keywords: llmMeta.keywords ?? [],
      resource_url: '',
      resource_format: 'pdf',
      maintainer: '',
      publisher: '',
      license: '',
      begin_datetime: llmMeta.begin_datetime ?? '',
      // --- Optional ---
      schema_name: 'OGD Austria Metadata 2.6',
      schema_language: 'ger',
      schema_characterset: 'utf8',
      geographic_toponym: llmMeta.geographic_toponym ?? '',
      end_datetime: llmMeta.end_datetime ?? '',
      en_title_and_desc: [llmMeta.title_en, llmMeta.description_en]
        .filter(Boolean)
        .join(' — '),
      update_frequency: '',
      maintainer_email: '',
      publisher_link: '',
      license_url: '',
    }
    navigator.clipboard.writeText(JSON.stringify(output, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [llmMeta, metadataId, today])

  // ── Upload zone ─────────────────────────────────────────────────────────────
  if (phase === 'upload' || phase === 'error') {
    return (
      <div style={s.tabRoot}>
        <div style={s.tabHeader}>
          <span style={s.tabTitle}>DCAT-AP.at Metadata Generator</span>
          <span style={s.tabSubtitle}>
            OGD Austria Metadata v2.6 · data.gv.at standard ·{' '}
            <a
              href="https://go.gv.at/ogdmetaen"
              target="_blank"
              rel="noreferrer"
              style={s.docLink}
            >
              specification ↗
            </a>
          </span>
        </div>

        <div
          style={{
            ...s.dropZone,
            ...(isDragOver ? s.dropZoneActive : {}),
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          aria-label="Upload PDF"
        >
          <div style={s.dropIcon}>PDF</div>
          <div style={s.dropPrimary}>Drop a PDF here or click to browse</div>
          <div style={s.dropSecondary}>
            Text is extracted client-side · Content is sent to Nebius LLM for metadata inference
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {phase === 'error' && error && (
          <div style={s.errorBox}>
            <span style={s.errorLabel}>Error</span>
            <span style={s.errorMsg}>{error}</span>
          </div>
        )}

        <div style={s.standardNote}>
          <span style={s.standardNoteLabel}>Fields covered</span>
          <span style={s.standardNoteText}>
            12 mandatory core fields + 8 optional fields from DCAT-AP.at / OGD Austria Metadata
            v2.6. Fields that can be inferred from the PDF content are auto-populated by the LLM.
            Fields requiring organisational knowledge (maintainer, publisher, licence, URL) are
            flagged for manual input.
          </span>
        </div>
      </div>
    )
  }

  // ── Processing states ────────────────────────────────────────────────────────
  if (phase === 'extracting' || phase === 'analyzing') {
    return (
      <div style={s.tabRoot}>
        <div style={s.tabHeader}>
          <span style={s.tabTitle}>DCAT-AP.at Metadata Generator</span>
        </div>
        <div style={s.processingBox}>
          <div style={s.spinner} />
          <div style={s.processingFile}>{fileName}</div>
          <div style={s.processingMsg}>{statusMsg}</div>
          {phase === 'analyzing' && (
            <div style={s.processingHint}>
              This may take 10–30 seconds depending on the model response time.
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Results ──────────────────────────────────────────────────────────────────
  return (
    <div style={s.tabRoot}>
      {/* Header */}
      <div style={s.tabHeader}>
        <span style={s.tabTitle}>DCAT-AP.at Metadata Generator</span>
        <span style={s.tabSubtitle}>
          OGD Austria Metadata v2.6 ·{' '}
          <a
            href="https://go.gv.at/ogdmetaen"
            target="_blank"
            rel="noreferrer"
            style={s.docLink}
          >
            specification ↗
          </a>
        </span>
      </div>

      {/* File info + actions */}
      <div style={s.resultHeader}>
        <div style={s.resultFileInfo}>
          <span style={s.resultFileBadge}>PDF</span>
          <span style={s.resultFileName}>{fileName}</span>
        </div>
        <div style={s.resultActions}>
          <button type="button" onClick={handleCopyJson} style={s.copyBtn}>
            {copied ? 'Copied!' : 'Copy as JSON'}
          </button>
          <button type="button" onClick={handleReset} style={s.resetBtn}>
            Upload another PDF
          </button>
        </div>
      </div>

      {/* Section A: Auto-populated fields */}
      <div style={s.sectionHeading}>
        <span style={s.sectionDot} data-color="green" />
        <span style={s.sectionTitle}>Auto-populated fields</span>
        <span style={s.sectionDesc}>
          Generated from PDF content or fixed values per the standard
        </span>
      </div>

      <div style={s.fieldGrid}>
        {/* System-fixed fields */}
        <AutoFieldCard
          id={1}
          label="Metadata Identifier"
          shortName="metadata_identifier"
          dcatProp="dct:identifier"
          mandatory={true}
          value={metadataId}
        />
        <AutoFieldCard
          id={5}
          label="Metadata Modified"
          shortName="metadata_modified"
          dcatProp="dct:modified"
          mandatory={true}
          value={today}
        />
        <AutoFieldCard
          id={2}
          label="Schema Name"
          shortName="schema_name"
          dcatProp="dct:conformsTo"
          mandatory={false}
          value="OGD Austria Metadata 2.6"
        />
        <AutoFieldCard
          id={3}
          label="Schema Language"
          shortName="schema_language"
          dcatProp="dct:language"
          mandatory={false}
          value="ger"
        />
        <AutoFieldCard
          id={4}
          label="Schema Character Set"
          shortName="schema_characterset"
          dcatProp="—"
          mandatory={false}
          value="utf8"
        />
        <AutoFieldCard
          id={15}
          label="Resource Format"
          shortName="resource_format"
          dcatProp="dct:format"
          mandatory={true}
          value="pdf"
        />

        {/* LLM-extracted fields */}
        <AutoFieldCard
          id={8}
          label="Title (DE)"
          shortName="title"
          dcatProp="dct:title"
          mandatory={true}
          value={llmMeta?.title_de}
        />
        <AutoFieldCard
          id={28}
          label="Title (EN)"
          shortName="en_title_and_desc (title)"
          dcatProp="—"
          mandatory={false}
          value={llmMeta?.title_en}
        />
        <AutoFieldCard
          id={9}
          label="Description (DE)"
          shortName="description"
          dcatProp="dct:description"
          mandatory={true}
          value={llmMeta?.description_de}
        />
        <AutoFieldCard
          id={28}
          label="Description (EN)"
          shortName="en_title_and_desc (description)"
          dcatProp="—"
          mandatory={false}
          value={llmMeta?.description_en}
        />
        <AutoFieldCard
          id={10}
          label="Categorization"
          shortName="categorization"
          dcatProp="dcat:theme"
          mandatory={true}
          value={llmMeta?.categories}
        />
        <AutoFieldCard
          id={11}
          label="Keywords"
          shortName="keywords"
          dcatProp="dcat:keyword"
          mandatory={true}
          value={llmMeta?.keywords}
        />
        <AutoFieldCard
          id={22}
          label="Geographic Toponym"
          shortName="geographic_toponym"
          dcatProp="dct:spatial"
          mandatory={false}
          value={llmMeta?.geographic_toponym}
        />
        <AutoFieldCard
          id={24}
          label="Begin Date / Time"
          shortName="begin_datetime"
          dcatProp="dct:temporal"
          mandatory={true}
          value={llmMeta?.begin_datetime}
        />
        <AutoFieldCard
          id={25}
          label="End Date / Time"
          shortName="end_datetime"
          dcatProp="dct:temporal"
          mandatory={false}
          value={llmMeta?.end_datetime}
        />
      </div>

      {/* Section B: Manual fields */}
      <div style={{ ...s.sectionHeading, marginTop: 32 }}>
        <span style={{ ...s.sectionDot, background: '#f0a020' }} />
        <span style={s.sectionTitle}>Requires manual input</span>
        <span style={s.sectionDesc}>
          These fields cannot be inferred from the document — they require organisational knowledge
        </span>
      </div>

      <div style={s.fieldGrid}>
        <ManualFieldCard
          id={14}
          label="Resource URL"
          shortName="resource_url"
          dcatProp="dcat:accessURL"
          mandatory={true}
          note="Provide the URL where this resource will be published or accessed on data.gv.at."
        />
        <ManualFieldCard
          id={19}
          label="Maintainer"
          shortName="maintainer"
          dcatProp="dcat:contactPoint"
          mandatory={true}
          note="Name of the person or organisation responsible for maintaining this resource."
        />
        <ManualFieldCard
          id={20}
          label="Publisher"
          shortName="publisher"
          dcatProp="dct:publisher"
          mandatory={true}
          note="Name of the organisation publishing this metadata record on data.gv.at, e.g. Stadt Wien."
        />
        <ManualFieldCard
          id={21}
          label="Licence"
          shortName="license"
          dcatProp="dct:license"
          mandatory={true}
          note="Specify the licence under which the resource is published. OGD standard: Creative Commons Namensnennung 4.0 International (CC BY 4.0)."
        />
        <ManualFieldCard
          id={26}
          label="Update Frequency"
          shortName="update_frequency"
          dcatProp="dct:accrualPeriodicity"
          mandatory={false}
          note="How often is this resource updated? e.g. annually, monthly, irregular, never."
        />
        <ManualFieldCard
          id={34}
          label="Maintainer E-Mail"
          shortName="maintainer_email"
          dcatProp="dcat:contactPoint"
          mandatory={false}
          note="Contact e-mail address for the maintainer or responsible department."
        />
        <ManualFieldCard
          id={35}
          label="Publisher Link"
          shortName="publisher_link"
          dcatProp="dct:publisher"
          mandatory={false}
          note="URL to the publisher's website or organisational profile page."
        />
        <ManualFieldCard
          id={38}
          label="Licence URL"
          shortName="license_url"
          dcatProp="dct:license"
          mandatory={false}
          note="URL to the full licence document, e.g. https://creativecommons.org/licenses/by/4.0/"
        />
      </div>

      {/* Copy JSON footer */}
      <div style={s.footer}>
        <button type="button" onClick={handleCopyJson} style={s.copyBtnLarge}>
          {copied ? 'Copied to clipboard!' : 'Copy full metadata as JSON'}
        </button>
        <span style={s.footerNote}>
          Empty string fields require manual input before publishing to data.gv.at
        </span>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  tabRoot: {
    maxWidth: 1100,
  },
  tabHeader: {
    marginBottom: 20,
  },
  tabTitle: {
    display: 'block',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#5b6af0',
    marginBottom: 4,
  },
  tabSubtitle: {
    display: 'block',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
  },
  docLink: {
    color: '#5b6af0',
    textDecoration: 'none',
  },

  // Drop zone
  dropZone: {
    border: '2px dashed #2e2e34',
    borderRadius: 10,
    padding: '52px 32px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
    background: '#19191c',
    marginBottom: 16,
    outline: 'none',
  },
  dropZoneActive: {
    borderColor: '#5b6af0',
    background: 'rgba(91,106,240,0.06)',
  },
  dropIcon: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#5b6af0',
    background: 'rgba(91,106,240,0.12)',
    border: '1px solid rgba(91,106,240,0.3)',
    borderRadius: 4,
    padding: '3px 8px',
    display: 'inline-block',
    marginBottom: 16,
  },
  dropPrimary: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontSize: 15,
    fontWeight: 500,
    color: '#e8e8ec',
    marginBottom: 8,
  },
  dropSecondary: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
  },

  // Error box
  errorBox: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    background: 'rgba(220,60,60,0.08)',
    border: '1px solid rgba(220,60,60,0.25)',
    borderRadius: 6,
    padding: '10px 14px',
    marginBottom: 16,
  },
  errorLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    color: '#e05050',
    whiteSpace: 'nowrap',
    marginTop: 1,
  },
  errorMsg: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#c07070',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
  },

  // Standard note
  standardNote: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    background: '#19191c',
    border: '1px solid #2e2e34',
    borderRadius: 6,
    padding: '10px 14px',
  },
  standardNoteLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#5b6af0',
    whiteSpace: 'nowrap',
    marginTop: 1,
  },
  standardNoteText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
    lineHeight: 1.7,
  },

  // Processing
  processingBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 32px',
    gap: 12,
  },
  spinner: {
    width: 28,
    height: 28,
    border: '3px solid #2e2e34',
    borderTopColor: '#5b6af0',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    marginBottom: 4,
  },
  processingFile: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: '#e8e8ec',
  },
  processingMsg: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#5b6af0',
  },
  processingHint: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
  },

  // Result header
  resultHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottom: '1px solid #2e2e34',
  },
  resultFileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  resultFileBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: '#5b6af0',
    background: 'rgba(91,106,240,0.12)',
    border: '1px solid rgba(91,106,240,0.3)',
    borderRadius: 4,
    padding: '2px 7px',
  },
  resultFileName: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: '#e8e8ec',
  },
  resultActions: {
    display: 'flex',
    gap: 8,
  },
  copyBtn: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    background: '#5b6af0',
    color: '#fff',
    padding: '7px 16px',
    border: 'none',
    borderRadius: 6,
  },
  resetBtn: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    background: '#19191c',
    color: '#7a7a85',
    padding: '7px 16px',
    border: '1px solid #2e2e34',
    borderRadius: 6,
  },

  // Section headings
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#3ecf8e',
    flexShrink: 0,
  },
  sectionTitle: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: '#e8e8ec',
  },
  sectionDesc: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
  },

  // Field grid
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 10,
  },

  // Field card
  fieldCard: {
    background: '#19191c',
    border: '1px solid #2e2e34',
    borderRadius: 8,
    padding: '12px 14px',
  },
  fieldCardManual: {
    borderColor: 'rgba(240,160,32,0.2)',
    background: 'rgba(240,160,32,0.03)',
  },
  fieldHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  fieldId: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: '#4a4a55',
    minWidth: 24,
  },
  fieldLabel: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontSize: 12,
    fontWeight: 500,
    color: '#e8e8ec',
    flex: 1,
    minWidth: 80,
  },
  mandatoryBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: '#5b6af0',
    background: 'rgba(91,106,240,0.1)',
    border: '1px solid rgba(91,106,240,0.2)',
    borderRadius: 3,
    padding: '1px 5px',
  },
  filledBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: '#3ecf8e',
    background: 'rgba(62,207,142,0.08)',
    border: '1px solid rgba(62,207,142,0.2)',
    borderRadius: 3,
    padding: '1px 5px',
  },
  partialBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: '#7a7a85',
    background: 'rgba(122,122,133,0.08)',
    border: '1px solid rgba(122,122,133,0.2)',
    borderRadius: 3,
    padding: '1px 5px',
  },
  manualBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: '#f0a020',
    background: 'rgba(240,160,32,0.08)',
    border: '1px solid rgba(240,160,32,0.2)',
    borderRadius: 3,
    padding: '1px 5px',
  },
  fieldMeta: {
    display: 'flex',
    gap: 8,
    marginBottom: 6,
  },
  fieldShortName: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: '#5b6af0',
  },
  fieldDcat: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: '#4a4a55',
  },
  fieldValue: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#c8c8d0',
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  fieldEmpty: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#3a3a42',
    fontStyle: 'italic',
  },
  fieldNote: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#a07830',
    lineHeight: 1.6,
  },

  // Footer
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginTop: 32,
    paddingTop: 20,
    borderTop: '1px solid #2e2e34',
    flexWrap: 'wrap',
  },
  copyBtnLarge: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    background: '#5b6af0',
    color: '#fff',
    padding: '10px 22px',
    border: 'none',
    borderRadius: 6,
    whiteSpace: 'nowrap',
  },
  footerNote: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4a4a55',
  },
}
