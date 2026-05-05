/**
 * Convert katalog_metadaten_total_wien.jsonl (DCAT JSON-LD, one dataset per line)
 * → src/data/sample-datasets.json (CKAN-shaped array for the app).
 *
 * Default mode: includes ALL valid records (no sampling).
 * Legacy sampling mode: set KEEP_ALL=0 to use topic bucketing instead.
 *
 * Usage:
 *   node scripts/jsonl-to-sample.mjs
 *   JSONL_PATH="C:\Users\laure\Downloads\katalog_metadaten_total_wien.jsonl" node scripts/jsonl-to-sample.mjs
 *   KEEP_ALL=0 node scripts/jsonl-to-sample.mjs   # legacy topic-sampling mode
 *
 * Env:
 *   JSONL_PATH    — path to the JSONL file (auto-detected if not set)
 *   KEEP_ALL      — set to "0" to enable topic sampling instead of keeping all records (default: "1")
 *   TOP_PER_TOPIC — max records per topic bucket when KEEP_ALL=0 (default 40)
 *   NOISE_COUNT   — extra off-topic records when KEEP_ALL=0 (default 80)
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// ── Path resolution ───────────────────────────────────────────────────────────
function resolveJsonlPath() {
  if (process.env.JSONL_PATH) return path.resolve(process.env.JSONL_PATH)
  const candidates = [
    path.join(root, 'src', 'data', 'katalog_metadaten_total_wien.jsonl'),
    path.join(os.homedir(), 'Downloads', 'katalog_metadaten_total_wien.jsonl'),
    path.join(root, 'katalog_metadaten_total_wien.jsonl'),
    path.join(root, 'src', 'data', 'katalog_metadaten_total.jsonl'),
    path.join(os.homedir(), 'Downloads', 'katalog_metadaten_total.jsonl'),
    path.join(root, 'alle_metadaten_stream.jsonl'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0]
}

const jsonlPath = resolveJsonlPath()
const outPath = path.join(root, 'src', 'data', 'sample-datasets.json')
const KEEP_ALL = process.env.KEEP_ALL !== '0'
const TOP_PER_TOPIC = Math.max(10, Number(process.env.TOP_PER_TOPIC) || 40)
const NOISE_COUNT = Math.max(10, Number(process.env.NOISE_COUNT) || 80)

// ── Topic keyword sets (lowercase, matched against title+desc+keywords) ───────
const TOPICS = [
  {
    id: 'bevoelkerung',
    // Long compound words avoid false substring matches
    keywords: ['bevölkerung', 'bevolkerung', 'einwohnerzahl', 'demografisch', 'altersstruktur', 'altersgruppe', 'volkszählung', 'volkszahlung', 'bevölkerungsstatistik', 'bevölkerungsprognose'],
  },
  {
    id: 'luftqualitaet',
    // "luft" alone is too short; use "luftqualität" or compound forms
    keywords: ['luftqualität', 'luftqualitat', 'luftgüte', 'luftgute', 'feinstaub', 'pm10', 'pm2.5', 'no2-', 'ozonmess', 'luftimmission', 'luftmessstation', 'luftschadstoff', 'stickstoffdioxid', 'immissionswert'],
  },
  {
    id: 'haltestellen',
    // "bus" is too short; use "bushaltestelle" or longer forms
    keywords: ['haltestelle', 'öffentlicher verkehr', 'offentlicher verkehr', 'gtfs', 'liniennetz', 'straßenbahnlinie', 'strassenbahnlinie', 'buslinien', 'bushaltestelle', 'u-bahn-station', 'öv-güteklasse', 'fahrplanauskunft'],
  },
  {
    id: 'haushaltseinkommen',
    keywords: ['haushaltseinkommen', 'nettoeinkommen', 'medianeinkommen', 'lohnsteuerstatistik', 'eu-silc', 'armutsgefährdung', 'armutsgefährdungsquote', 'einkommensverteilung', 'verfügbares einkommen', 'äquivalenzeinkommen'],
  },
  {
    id: 'wahlergebnisse',
    // "wahl" alone matches Wahlsprengel (electoral precinct) and council minutes — use full compound words
    keywords: ['wahlergebnis', 'nationalratswahl', 'gemeinderatswahl', 'landtagswahl', 'bundespräsidentenwahl', 'europawahl', 'wahlbeteiligung', 'stimmenanteil', 'stimmenzahl', 'wahlkreis'],
  },
  {
    id: 'kindergarten',
    keywords: ['kindergarten', 'kinderbetreuung', 'kinderkrippe', 'kindertagesheim', 'elementarpädagogik', 'elementarpadagogik', 'betreuungsplatz', 'kindergartenplatz', 'vorschule', 'krabbelstube'],
  },
  {
    id: 'wasserqualitaet',
    // "wasser" alone matches Abwasser, Trinkwasser broadly; use specific quality-related terms
    keywords: ['wasserqualität', 'wasserqualitat', 'gewässerqualität', 'gewässergüte', 'fließgewässer', 'badegewässer', 'gewässermonitoring', 'wasserrahmenrichtlinie', 'wrrl', 'grundwasserqualität', 'oberflächengewässer'],
  },
  {
    id: 'baugenehmigungen',
    // "bau" alone matches Umweltbeobachtung, Ausbau etc.; use full compound words
    keywords: ['baugenehmigung', 'baubewilligung', 'wohnungsbau', 'wohnbauförderung', 'baubewilligungen', 'neubaugenehmigung', 'wohngebäude', 'baufertigstellung', 'baubeginne', 'baupreisindex'],
  },
]

// ── JSON-LD helpers ───────────────────────────────────────────────────────────

/** Extract a plain string from any JSON-LD value variant. */
function extractValue(x) {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (Array.isArray(x)) {
    // Try first item that has @value; skip @id-only refs (unresolvable blank nodes)
    for (const item of x) {
      const v = extractValue(item)
      if (v) return v
    }
    return ''
  }
  if (typeof x === 'object') {
    if ('@value' in x) return String(x['@value'])
    // @id-only objects (blank node refs or URIs) — not a text value
    return ''
  }
  return ''
}

/** Extract all keyword strings from dcat:keyword (single or array, any variant). */
function extractKeywords(kw) {
  if (!kw) return []
  const items = Array.isArray(kw) ? kw : [kw]
  const out = []
  for (const item of items) {
    const v = extractValue(item)
    if (v) out.push(v)
  }
  return out
}

function isDataset(node) {
  const t = node['@type']
  if (t === 'dcat:Dataset') return true
  if (Array.isArray(t)) return t.includes('dcat:Dataset')
  return false
}

function refId(x) {
  if (!x) return null
  if (typeof x === 'string') return x
  if (typeof x === 'object' && x['@id']) return x['@id']
  return null
}

function datasetSlugFromGraphId(graphId) {
  if (!graphId || typeof graphId !== 'string') return ''
  const m = graphId.match(/\/datasets\/([^/?#]+)/i)
  return (m ? m[1] : graphId).toLowerCase()
}

function toCkanRow(graph, datasetNode) {
  const byId = new Map()
  for (const n of graph) {
    if (n['@id']) byId.set(n['@id'], n)
  }

  // Publisher name
  let publisherTitle = ''
  const pubRef = refId(datasetNode['dct:publisher'])
  if (pubRef && byId.has(pubRef)) {
    const p = byId.get(pubRef)
    publisherTitle = extractValue(p['foaf:name']) || extractValue(p['vcard:fn']) || ''
  }

  // Keywords → tags
  const kwValues = extractKeywords(datasetNode['dcat:keyword'])
  const tags = kwValues.map((k) => ({ name: k, display_name: k }))

  // Distribution → resource
  const resources = []
  const distField = datasetNode['dcat:distribution']
  const distRefs = distField
    ? (Array.isArray(distField) ? distField : [distField])
    : []
  for (const ref of distRefs) {
    const distId = refId(ref)
    if (!distId || !byId.has(distId)) continue
    const d = byId.get(distId)
    let url = ''
    const au = d['dcat:accessURL']
    if (au && typeof au === 'object' && au['@id']) url = au['@id']
    else if (typeof au === 'string') url = au
    if (!url) continue
    const fmt = refId(d['dct:format']) || ''
    let format = ''
    if (fmt.toLowerCase().includes('csv')) format = 'CSV'
    else if (fmt.toLowerCase().includes('json')) format = 'JSON'
    else if (fmt.toLowerCase().includes('geojson')) format = 'GeoJSON'
    else if (fmt.toLowerCase().includes('wfs')) format = 'WFS'
    else if (fmt.toLowerCase().includes('wms')) format = 'WMS'
    else if (fmt) format = fmt.split('/').pop().toUpperCase().slice(0, 20)
    const rname = extractValue(d['dct:title']) || extractValue(d['dct:identifier']) || ''
    resources.push({ format, url, name: rname })
    break // one resource per dataset is enough for the demo
  }

  const id = String(datasetNode['dct:identifier'] || '').toLowerCase()
  const slug = datasetSlugFromGraphId(datasetNode['@id']) || id || 'dataset'
  const title = extractValue(datasetNode['dct:title']) || slug
  const notes = extractValue(datasetNode['dct:description']) || ''
  const modified = extractValue(datasetNode['dct:modified']) || ''

  return {
    id: id || slug,
    name: slug,
    title,
    notes,
    author: publisherTitle,
    organization: publisherTitle
      ? {
          title: publisherTitle,
          name: publisherTitle.toLowerCase().replace(/\s+/g, '-').slice(0, 80),
        }
      : undefined,
    tags,
    metadata_modified: modified,
    resources,
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/** Returns index (0-based) of the best-matching topic, or -1 for no match. */
function scoreTopic(row) {
  const haystack = [row.title, row.notes, row.tags.map((t) => t.name).join(' ')]
    .join(' ')
    .toLowerCase()

  let bestTopic = -1
  let bestScore = 0
  for (let i = 0; i < TOPICS.length; i++) {
    let score = 0
    for (const kw of TOPICS[i].keywords) {
      if (haystack.includes(kw)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestTopic = i
    }
  }
  return bestScore > 0 ? bestTopic : -1
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(jsonlPath)) {
    console.error(`Missing JSONL file: ${jsonlPath}`)
    console.error('Set JSONL_PATH env var to the file location.')
    process.exit(1)
  }
  console.error(`Reading: ${jsonlPath}`)
  console.error(`Mode: ${KEEP_ALL ? 'KEEP_ALL (all valid records)' : 'sampling (topic buckets + noise)'}`)

  const seen = new Set()
  let lineCount = 0

  // KEEP_ALL mode: collect every valid record
  const allRecords = []

  // Sampling mode buckets
  const topicBuckets = TOPICS.map(() => /** @type {any[]} */ ([]))
  const noiseBucket = []

  const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    lineCount++

    let doc
    try { doc = JSON.parse(trimmed) } catch { continue }

    const graph = doc['@graph']
    if (!Array.isArray(graph)) continue

    for (const node of graph) {
      if (!isDataset(node)) continue
      const row = toCkanRow(graph, node)

      // Require a real title and skip duplicates
      if (!row.title || row.title === row.name || seen.has(row.name)) continue
      // Skip records with no useful text at all
      if (!row.title && !row.notes) continue
      seen.add(row.name)

      if (KEEP_ALL) {
        allRecords.push(row)
      } else {
        const topicIdx = scoreTopic(row)
        if (topicIdx >= 0) {
          topicBuckets[topicIdx].push(row)
        } else {
          // Noise: cap to 3× target to avoid blowing up memory, trim later
          if (noiseBucket.length < NOISE_COUNT * 3) {
            noiseBucket.push(row)
          }
        }
      }
    }
  }

  console.error(`Scanned ${lineCount} lines, found ${seen.size} unique datasets`)

  let selected = []

  if (KEEP_ALL) {
    selected = allRecords
    console.error(`Total: ${selected.length} records (all kept)`)
  } else {
    // Trim each topic bucket to TOP_PER_TOPIC
    for (let i = 0; i < TOPICS.length; i++) {
      const bucket = topicBuckets[i].slice(0, TOP_PER_TOPIC)
      console.error(`  Topic "${TOPICS[i].id}": ${bucket.length} records`)
      selected.push(...bucket)
    }

    // Add noise (deduplicate against already selected)
    const selectedIds = new Set(selected.map((r) => r.name))
    let noiseAdded = 0
    for (const row of noiseBucket) {
      if (noiseAdded >= NOISE_COUNT) break
      if (!selectedIds.has(row.name)) {
        selected.push(row)
        selectedIds.add(row.name)
        noiseAdded++
      }
    }
    console.error(`  Noise: ${noiseAdded} records`)
    console.error(`Total: ${selected.length} records`)
  }

  if (selected.length < 10) {
    console.error('Too few datasets. Check JSONL path and file structure.')
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(selected, null, 2))
  console.error(`\nWrote ${selected.length} rows → ${outPath}`)
  console.error('Next: NEBIUS_EMBEDDING_DIM=1024 node scripts/embed-sample.mjs')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
