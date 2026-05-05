import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev-only: GET /api/ckan-sample-bulk?n=100
 * Collects datasets via Hub-Search (see scripts/ckan-sample-collect.mjs).
 */
function ckanSampleBulkPlugin(): Plugin {
  return {
    name: 'ckan-sample-bulk',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = req.url?.split('?')[0]
        if (pathOnly !== '/api/ckan-sample-bulk' || req.method !== 'GET') {
          next()
          return
        }
        const url = new URL(req.url || '/', 'http://dev.local')
        const n = Math.min(500, Math.max(10, Number(url.searchParams.get('n')) || 100))
        try {
          const { collectSampleDatasets } = await import('./scripts/ckan-sample-collect.mjs')
          const port = server.config.server.port ?? 3000
          const list = await collectSampleDatasets({
            target: n,
            internalProxyBase: `http://127.0.0.1:${port}`,
          })
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(list))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: msg }))
        }
      })
    },
  }
}

/** Resolve Nebius OpenAI-compatible root (origin + first URL path segment, usually /v1). */
function nebiusProxyParts(rawBase: string): { target: string; pathPrefix: string } {
  const trimmed = rawBase.replace(/\/$/, '')
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const path = (u.pathname || '/v1').replace(/\/$/, '') || '/v1'
    return { target: `${u.protocol}//${u.host}`, pathPrefix: path }
  } catch {
    return { target: 'https://api.tokenfactory.nebius.com', pathPrefix: '/v1' }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const nebiusRaw = (
    env.VITE_NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1'
  ).replace(/\/$/, '')
  const { target: nebiusTarget, pathPrefix: nebiusPathPrefix } = nebiusProxyParts(nebiusRaw)

  return {
    plugins: [react(), ckanSampleBulkPlugin()],
    server: {
      port: 3000,
      proxy: {
        /** Legacy CKAN path (404 on data.gv.at); kept for mirrors. */
        '/api/ckan': {
          target: 'https://www.data.gv.at',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ckan/, '/katalog/api/3/action'),
          secure: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Accept', 'application/json, text/plain, */*')
              proxyReq.setHeader(
                'User-Agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              )
              proxyReq.setHeader('Referer', 'https://www.data.gv.at/katalog/')
              proxyReq.setHeader('Origin', 'https://www.data.gv.at')
            })
          },
        },
        '/api/hub/search': {
          target: 'https://www.data.gv.at',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/hub\/search/, '/api/hub/search'),
          secure: true,
          timeout: 60_000,
        },
        /**
         * Browser → same-origin /api/nebius/* → Nebius host (avoids CORS on chat/embeddings).
         * Target/path follow VITE_NEBIUS_BASE_URL from .env when set.
         */
        '/api/nebius': {
          target: nebiusTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/nebius/, nebiusPathPrefix),
          secure: true,
          timeout: 120_000,
        },
      },
    },
  }
})
