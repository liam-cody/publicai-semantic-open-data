/**
 * Build src/data/sample-datasets.json via the Vite dev proxy (Hub-Search).
 *
 *   npm run dev          # terminal 1
 *   npm run fetch-sample # terminal 2
 *
 * Uses shared logic in ckan-sample-collect.mjs (hits /api/hub/search/search on localhost).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const outPath = path.join(root, 'src', 'data', 'sample-datasets.json')

const AUTO_VITE = process.argv.includes('--auto-vite')
const PORT = process.env.FETCH_SAMPLE_PORT || '31987'
const BASE =
  process.env.CKAN_SAMPLE_BASE || (AUTO_VITE ? `http://localhost:${PORT}` : 'http://localhost:3000')

const TARGET_MAX = Math.min(500, Math.max(10, Number(process.env.SAMPLE_TARGET) || 100))

async function waitForProxy(maxAttempts = 90) {
  let lastSnippet = ''
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(
        `${BASE}/api/hub/search/search?q=wien&filters=dataset&limit=1`
      )
      const t = await r.text()
      lastSnippet = t.slice(0, 160).replace(/\s+/g, ' ')
      if (t.trim().startsWith('{')) {
        const j = JSON.parse(t)
        if (j.result?.results?.length >= 1) return
      }
    } catch (e) {
      lastSnippet = e instanceof Error ? e.message : String(e)
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(
    `No Hub-Search JSON from ${BASE}. Last: ${lastSnippet}\n` +
      `Run: npm run dev   or   npm run fetch-sample:auto`
  )
}

function startViteAuto() {
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(viteBin)) {
    throw new Error(`Vite not found at ${viteBin} — run npm install first`)
  }
  return spawn(process.execPath, [viteBin, '--port', PORT, '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
}

async function main() {
  let viteChild = null
  if (AUTO_VITE) {
    console.error(`Starting temporary Vite on port ${PORT}…`)
    viteChild = startViteAuto()
    const log = (d) => process.stderr.write(d)
    viteChild.stderr?.on('data', log)
    viteChild.stdout?.on('data', log)
    await waitForProxy()
  } else {
    await waitForProxy()
  }

  const { collectSampleDatasets } = await import('./ckan-sample-collect.mjs')
  const internal = BASE.replace(/\/$/, '')
  const list = await collectSampleDatasets({
    target: TARGET_MAX,
    internalProxyBase: internal,
  })

  if (list.length < Math.min(30, TARGET_MAX)) {
    throw new Error(`Too few datasets (${list.length}).`)
  }

  fs.writeFileSync(outPath, JSON.stringify(list, null, 2))
  console.error(`Wrote ${list.length} packages → ${outPath}`)
  console.error('Next: npm run embed-sample')

  if (viteChild) {
    try {
      viteChild.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    if (process.platform === 'win32' && viteChild.pid) {
      spawn('taskkill', ['/PID', String(viteChild.pid), '/F', '/T'], {
        shell: true,
        stdio: 'ignore',
      })
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
