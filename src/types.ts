import type {
  ApolloClientOptions,
  InMemoryCacheConfig,
  NormalizedCacheObject,
} from '@apollo/client/core'
import type { ApolloUploadConfig } from './utils/graphql.config'

export type VueApolloState = Record<string, NormalizedCacheObject>

export interface VueApolloRuntimeOptions {
  /** Create request-isolated clients. Defaults to automatic environment detection. */
  server?: boolean
  /** Request-specific headers, such as an explicitly filtered SSR cookie header. */
  headers?: Record<string, string>
  /** Cache state restored before any query composable is created. */
  initialState?: VueApolloState | null
  /** Request-specific fetch implementation. */
  fetch?: typeof fetch
  /** Abort all GraphQL work when the owning request is cancelled. */
  signal?: AbortSignal
  /** Per-operation transport timeout. Zero or undefined disables it. */
  requestTimeoutMs?: number
  /**
   * Register the clients in the legacy browser-global store. Server runtimes
   * default to false so concurrent requests can never overwrite each other.
   */
  registerGlobal?: boolean
}

export interface VueApolloClientOptions {
  endPoints: Record<string, string>
  tokenKey?: string
  tokenExpiration?: number | Date
  memoryConfig?: Partial<InMemoryCacheConfig>
  useGETForQueries?: boolean
  apolloClientConfig?: Partial<ApolloClientOptions<any>>
  apolloUploadConfig?: Partial<ApolloUploadConfig>
  refetchOnUpdate?: boolean
  refetchTimeout?: number
  allowOffline?: boolean
  refreshToken?: () => Promise<string | void | null>
  onLogout?: () => void
  /** Override cookie token lookup (for example, a storefront localStorage session). */
  getToken?: () => string | null | undefined
  /** Override token removal when authentication becomes invalid. */
  clearToken?: () => void
  /** Format the Authorization header. The legacy behavior returns the token unchanged. */
  formatToken?: (token: string) => string
  setContext?: (context: {
    operationName?: string
    variables?: any
    token?: string
  }) => Record<string, any>
}

// Global config injection key
export const APOLLO_CLIENT_CONFIG = Symbol('APOLLO_CLIENT_CONFIG')
