/**
 * AppConfig — reads VITE_ feature flags from .env
 * Import these constants instead of reading import.meta.env directly.
 */

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
export const ENABLE_INTERNAL_MONOLOGUE = import.meta.env.VITE_ENABLE_INTERNAL_MONOLOGUE === 'true'
export const HIDE_ORG_DATA_UI         = import.meta.env.VITE_HIDE_ORG_DATA_UI          === 'true'

export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? ''
export const GEMINI_MODEL   = 'gemini-2.5-flash-lite'

export const PINECONE_API_KEY   = import.meta.env.VITE_PINECONE_API_KEY   ?? ''
export const PINECONE_ENV       = import.meta.env.VITE_PINECONE_ENVIRONMENT ?? ''
export const PINECONE_INDEX     = import.meta.env.VITE_PINECONE_INDEX_NAME  ?? 'borg-knowledge'
