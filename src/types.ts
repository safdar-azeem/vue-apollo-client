import type {
  ApolloClientOptions,
  InMemoryCacheConfig,
  NormalizedCacheObject,
  OperationVariables,
} from '@apollo/client/core/index.js'
import type { DocumentNode } from 'graphql'
import type { ApolloUploadConfig } from './utils/graphql.config'

export type VueApolloState = Record<string, NormalizedCacheObject>

export interface VueApolloRuntimeOptions {
  /** Create request-isolated clients. Defaults to automatic environment detection. */
  server?: boolean
  /** Request-specific headers, such as an explicitly filtered SSR cookie header. */
  headers?: Record<string, string>
  /** Cache state restored before any query composable is created. */
  initialState?: VueApolloState | null
  /** Safe, user-only auth state restored before browser middleware runs. */
  initialAuthState?: VueApolloAuthHydrationState | null
  /** Request-specific fetch implementation. */
  fetch?: typeof fetch
  /** Abort all GraphQL work when the owning request is cancelled. */
  signal?: AbortSignal
  /** Per-operation transport timeout. Zero or undefined disables it. */
  requestTimeoutMs?: number
  /** Internal request headers used by SSR authentication and transport. */
  requestHeaders?: Record<string, string>
  /**
   * Register the clients in the legacy browser-global store. Server runtimes
   * default to false so concurrent requests can never overwrite each other.
   */
  registerGlobal?: boolean
  /**
   * Key under which this runtime's extracted cache is contributed to (server)
   * and restored from (browser) a generic SSR hydration host. Defaults to
   * `apollo`. Give each named runtime a distinct key when installing several.
   */
  hydrationKey?: string
  /** Internal application context used to execute generated composables safely. */
  runWithContext?: <T>(callback: () => T) => T
}

export interface AuthSession {
  /** Access credential for token-based sessions. */
  token?: string | null
  /** Refresh credential for token-based sessions. */
  refreshToken?: string | null
  /** Optional current user returned by the consumer's login flow. */
  user?: any | null
}

/** Generic authentication configuration installed through `defineApollo`. */
export interface VueApolloAuthOptions {
  /** Generated `useMeQuery`-style composable used for session verification. */
  useMeQuery?: (options?: any) => any
  /** @deprecated Lower-level document form retained for compatibility. */
  meQuery?: DocumentNode
  /** Select the authenticated user from the Me query result. */
  meSelector?: (data: any) => any
  /** Consumer-provided permission projection; the library only compares strings. */
  permissions?: (user: any) => readonly string[] | null | undefined
  /** Destination used by the legacy `verify()`/logout navigation behavior. */
  loginRoute?: string
  /** Query-string reason used by legacy `verify()` redirects. */
  sessionExpiredReason?: string
  clientId?: string
  authBoundary?: string
  tokenKey?: string
  /** Browser or request-aware access-token lookup for custom stores. */
  getToken?: () => string | null | undefined
  /** Custom access/refresh-token persistence for custom stores. */
  setToken?: (session: AuthSession) => void | Promise<void>
  /** Custom access/refresh-token removal for custom stores. */
  clearToken?: () => void | Promise<void>
  /** Optional explicit navigation retained for compatibility integrations. */
  navigate?: (path: string) => void | Promise<void>
  /** Use a cookie-backed session even when the browser cannot read its cookie. */
  sessionMode?: 'token' | 'cookie'
  /**
   * Authoritative server-session termination for cookie-backed sessions.
   * Required when `sessionMode` is `cookie` because JavaScript cannot remove
   * an HttpOnly cookie.
   */
  clearSession?: () => void | Promise<unknown>
}

/** Hydration contains only the current user; credentials never cross this boundary. */
export interface VueApolloAuthHydrationState {
  user: any | null
}

export interface VueApolloRefreshTokens {
  token: string
  refreshToken?: string | null
}

export interface VueApolloRefreshContract<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
> {
  /** Generated mutation composable. Preferred for application configuration. */
  useMutation?: (options?: any) => {
    mutate: (
      variables?: TVariables,
      options?: any
    ) => Promise<{ data?: TData | null } | null | undefined>
  }
  /** @deprecated Prefer `useMutation` so application code never imports documents. */
  document?: DocumentNode
  clientId?: string
  /** Optional for the normal cookie-token store; defaults to `tokenKey`. */
  getRefreshToken?: () => string | null | undefined
  createVariables: (refreshToken: string) => TVariables
  selectTokens: (data: TData) => VueApolloRefreshTokens | null | undefined
  /** Optional for the normal cookie-token store; persists with `tokenKey`. */
  persistTokens?: (tokens: VueApolloRefreshTokens) => void | Promise<void>
  /** Optional for the normal cookie-token store; removes both token cookies. */
  clearTokens?: () => void | Promise<void>
}

export type TokenCookieSameSite =
  | 'strict'
  | 'Strict'
  | 'lax'
  | 'Lax'
  | 'none'
  | 'None'

/** Cookie attributes shared by the access, refresh, and temporary token cookies. */
export interface TokenCookieOptions {
  domain?: string
  path?: string
  secure?: boolean
  sameSite?: TokenCookieSameSite
  [property: string]: any
}

export interface VueApolloClientOptions {
  /** Stable Vue application identity used to isolate persisted runtime state. */
  applicationId?: string
  /** Stable authentication boundary, for example `portal` or `billing`. */
  authBoundary?: string
  /** Normal single-endpoint configuration. */
  endpoint?: string
  /** Advanced named-client configuration. Do not combine with `endpoint`. */
  endPoints?: Record<string, string>
  /** Optional transport override, primarily for edge runtimes and tests. */
  fetch?: typeof fetch
  /** Per-operation transport timeout applied automatically in every runtime. */
  requestTimeoutMs?: number
  tokenKey?: string
  /** Token or server-managed cookie session transport. */
  sessionMode?: 'token' | 'cookie'
  /** Fetch credential mode, useful for server-managed cookie sessions. */
  credentials?: RequestCredentials
  /** Explicit cookie attributes for the token, refresh, and stash cookies. */
  tokenCookie?: TokenCookieOptions
  tokenExpiration?: number | Date
  memoryConfig?: Partial<InMemoryCacheConfig>
  useGETForQueries?: boolean
  apolloClientConfig?: Partial<ApolloClientOptions<any>>
  apolloUploadConfig?: Partial<ApolloUploadConfig>
  refetchOnUpdate?: boolean
  refetchTimeout?: number
  allowOffline?: boolean
  /** Identifies the current session without persisting access tokens. */
  getSessionId?: () => string | null | undefined
  /** Generated-composable refresh contract owned and executed by this runtime. */
  refresh?: VueApolloRefreshContract<any, any>
  /** @deprecated Use `refresh` with a generated document. */
  refreshToken?: () => Promise<string | void | null>
  onLogout?: () => void
  /** Override cookie token lookup (for example, a storefront localStorage session). */
  getToken?: () => string | null | undefined
  /** Override access/refresh-token persistence for a custom store. */
  setToken?: (session: AuthSession) => void | Promise<void>
  /** Override token removal when authentication becomes invalid. */
  clearToken?: () => void | Promise<void>
  /** Format the Authorization header. The legacy behavior returns the token unchanged. */
  formatToken?: (token: string) => string
  setContext?: (context: {
    operationName?: string
    variables?: any
    token?: string
  }) => Record<string, any>
  /** Preferred installed authentication configuration. */
  auth?: VueApolloAuthOptions
}

// Global config injection key
export const APOLLO_CLIENT_CONFIG = Symbol('APOLLO_CLIENT_CONFIG')
