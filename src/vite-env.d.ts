/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEBIUS_API_KEY?: string
  readonly VITE_NEBIUS_BASE_URL?: string
  readonly VITE_NEBIUS_CHAT_MODEL?: string
  readonly VITE_NEBIUS_EMBEDDING_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
