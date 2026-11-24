/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL de base de l'API (par défaut « /api », relayé par le proxy Vite ou le reverse proxy). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
