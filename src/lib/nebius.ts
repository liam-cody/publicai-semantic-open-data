/**
 * Nebius Token Factory — OpenAI-compatible inference base URL and helpers.
 * @see https://docs.tokenfactory.nebius.com/api-reference/introduction
 */

export interface NebiusClientConfig {
  baseUrl: string
  apiKey: string
  chatModel: string
  embeddingModel: string
}

export function getNebiusConfig(): NebiusClientConfig {
  const configured =
    import.meta.env.VITE_NEBIUS_BASE_URL?.replace(/\/$/, '') ??
    'https://api.tokenfactory.nebius.com/v1'
  /** In dev, call Nebius through Vite proxy (browsers get NetworkError on direct API — no CORS). */
  const useBrowserProxy =
    import.meta.env.DEV && import.meta.env.VITE_NEBIUS_BROWSER_PROXY !== '0'
  const baseUrl = useBrowserProxy ? '/api/nebius' : configured
  return {
    baseUrl,
    apiKey: import.meta.env.VITE_NEBIUS_API_KEY ?? '',
    chatModel: import.meta.env.VITE_NEBIUS_CHAT_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct',
    embeddingModel: import.meta.env.VITE_NEBIUS_EMBEDDING_MODEL ?? 'Qwen/Qwen3-Embedding-8B',
  }
}

function fetchSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
}

export async function nebiusEmbedQuery(
  cfg: NebiusClientConfig,
  text: string,
  dimensions?: number
): Promise<number[]> {
  let res: Response
  const body: Record<string, unknown> = { model: cfg.embeddingModel, input: text }
  if (dimensions) body.dimensions = dimensions
  try {
    res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: fetchSignal(90_000),
    })
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error('Nebius embeddings: request timed out (90s). Check proxy / network.')
    }
    throw e
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
    const msg = (err as { error?: { message?: string } })?.error?.message ?? res.statusText
    throw new Error(`Nebius embeddings error: ${msg}`)
  }

  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> }
  const emb = data.data?.[0]?.embedding
  if (!emb?.length) throw new Error('Nebius embeddings: empty response')
  return emb
}

export async function nebiusChatCompletion(
  cfg: NebiusClientConfig,
  userPrompt: string,
  maxTokens = 1024
): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.chatModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      /** Rerank prompts are large; allow a slow model to finish. */
      signal: fetchSignal(180_000),
    })
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error('Nebius chat: request timed out (180s). Try again or reduce candidates.')
    }
    throw e
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
    const msg = (err as { error?: { message?: string } })?.error?.message ?? res.statusText
    throw new Error(`Nebius chat error: ${msg}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('Nebius chat: no message content')
  return text
}
