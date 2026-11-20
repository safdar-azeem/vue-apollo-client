import { computed, effectScope, ref, type ComputedRef, type Ref } from 'vue'
import {
  useApolloRuntime,
  type VueApolloRuntime,
} from '../createApollo'
import { isApolloStoreResetError } from '../ApolloSessionRuntime'
import {
  getCookieValueFromHeader,
  getToken,
  removeToken,
  setToken as setCookieToken,
} from './useCookies'
import type {
  AuthSession,
  VueApolloAuthHydrationState,
  VueApolloAuthOptions,
} from '../types'

export interface UseAuthOptions extends VueApolloAuthOptions {
  /** Internal initial state supplied by the installed runtime. */
  initialUser?: any | null
  /** Internal marker for a user restored from SSR hydration. */
  initialAuthHydrated?: boolean
  /** Internal compatibility switch; installed auth does not navigate implicitly. */
  autoNavigate?: boolean
}

export interface GeneratedAuthQuery {
  result?: Ref<any>
  loading?: Ref<boolean>
  onResult: (callback: (result: { data?: any; loading?: boolean }) => void) => {
    off: () => void
  }
  onError: (callback: (error: any) => void) => { off: () => void }
  stop?: () => void
}

export interface AuthState {
  user: Ref<any | null>
  isAuthenticated: ComputedRef<boolean>
  loading: Ref<boolean>
  error: Ref<any | null>
  /** Legacy verification that redirects after an expired session. */
  verify: () => Promise<boolean>
  /** Session verification primitive; never performs navigation. */
  verifySession: () => Promise<boolean>
  /** Establish a token or already-established server-managed session. */
  setSession: (session: AuthSession) => Promise<void>
  /** Idempotent authentication teardown without navigation. */
  clearSession: () => Promise<void>
  /** Logout session mechanics; navigation is only compatibility behavior. */
  logout: (navigate?: (path: string) => void | Promise<void>) => Promise<void>
  /** Safely decode generic JWT claims from the current access token. */
  getTokenClaims: () => Record<string, unknown> | null
  /** Any matching permission is sufficient for an array requirement. */
  can: (permission: string | string[]) => boolean
  /** Legacy local-state reset. */
  reset: () => void
}

interface VerificationResult {
  valid: boolean
  expired: boolean
}

interface AuthInternalState extends AuthState {
  inflight: Promise<VerificationResult> | null
  inflightId: number | null
  nextVerificationId: number
  transitionPromise: Promise<void> | null
  teardownPromise: Promise<void> | null
  tearingDown: boolean
  expiredNavigation: Promise<void> | null
  sessionVersion: number
  hydratedVerificationPending: boolean
}

const runtimeStates = new WeakMap<
  VueApolloRuntime,
  Map<string, AuthInternalState>
>()
const configuredStates = new Map<string, AuthInternalState>()
const authInternals = new WeakMap<AuthState, AuthInternalState>()
let compatibilityRouter: any = null

/** @deprecated Pass `navigate` to `createAuthRuntime` instead. */
export const setAuthRouter = (router: any) => {
  compatibilityRouter = router
}

const isAuthError = (error: any): boolean => {
  // FORBIDDEN/HTTP 403 belongs to operation authorization. It must not tear
  // down an authenticated session merely because another operation was denied.
  const graphQLErrors: any[] = error?.graphQLErrors || []
  if (graphQLErrors.some((entry: any) => {
    const code = entry?.extensions?.code
    if (code === 'UNAUTHENTICATED') {
      return true
    }
    if (code) return false
    return /unauthori[sz]ed/i.test(entry?.message ?? '') ||
      /user not found/i.test(entry?.message ?? '')
  })) return true
  const statusCode =
    error?.networkError?.statusCode ?? error?.networkError?.result?.status ??
    error?.statusCode ?? error?.status
  return statusCode === 401
}

const navigate = async (
  path: string,
  options: UseAuthOptions,
  override?: (path: string) => void | Promise<void>
) => {
  if (typeof window === 'undefined') return
  if (override) return void await override(path)
  if (options.navigate) return void await options.navigate(path)
  if (compatibilityRouter?.push) return void await compatibilityRouter.push(path)
  window.location.assign(path)
}

const isApolloRuntime = (value: unknown): value is VueApolloRuntime =>
  Boolean(value && typeof value === 'object' && 'executeQuery' in value)

const readHeader = (
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | undefined => {
  if (!headers) return undefined
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  return entry?.[1]
}

const readRequestToken = (
  runtime: VueApolloRuntime,
  tokenKey: string
): string | undefined => {
  const authorization = readHeader(runtime.requestHeaders, 'authorization')
  if (authorization) {
    return authorization.replace(/^Bearer\s+/i, '').trim() || undefined
  }
  return getCookieValueFromHeader(
    readHeader(runtime.requestHeaders, 'cookie'),
    tokenKey,
  )
}

const executeGeneratedAuthQuery = async (
  runtime: VueApolloRuntime,
  createQuery: NonNullable<UseAuthOptions['useMeQuery']>,
  clientId: string,
  attempt = 0,
): Promise<{ data?: any }> => {
  const scope = effectScope()
  const createQueryInstance = () => scope.run(() =>
    createQuery({
      clientId,
      fetchPolicy: 'network-only',
      errorPolicy: 'none',
    })
  )!
  const query = (runtime.runWithContext
    ? runtime.runWithContext(createQueryInstance)
    : createQueryInstance()) as GeneratedAuthQuery
  try {
    return await new Promise<{ data?: any }>((resolve, reject) => {
      let settled = false
      let resultSubscription: { off: () => void } = { off: () => {} }
      let errorSubscription: { off: () => void } = { off: () => {} }
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        resultSubscription.off()
        errorSubscription.off()
        callback()
      }
      resultSubscription = query.onResult((result) => {
        if (result.loading) return
        settle(() => resolve({ data: result.data }))
      })
      if (settled) resultSubscription.off()
      errorSubscription = query.onError((error) => settle(() => reject(error)))
      if (settled) errorSubscription.off()
      queueMicrotask(() => {
        if (!query.loading?.value && query.result?.value !== undefined) {
          settle(() => resolve({ data: query.result?.value }))
        }
      })
    })
  } catch (error) {
    // Apollo invariant #42 can be observed by a watcher during an explicit
    // session transition. One retry keeps verification deterministic.
    if (isApolloStoreResetError(error) && attempt < 1) {
      return executeGeneratedAuthQuery(runtime, createQuery, clientId, attempt + 1)
    }
    throw error
  } finally {
    query.stop?.()
    scope.stop()
  }
}

const decodeBase64Url = (value: string): string | null => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`
    if (typeof atob === 'function') {
      const binary = atob(padded)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    }
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

const decodeTokenClaims = (
  token: string | null | undefined
): Record<string, unknown> | null => {
  if (!token) return null
  const encodedPayload = token.split('.')[1]
  if (!encodedPayload) return null
  const decoded = decodeBase64Url(encodedPayload)
  if (!decoded) return null
  try {
    const claims = JSON.parse(decoded)
    return claims && typeof claims === 'object' && !Array.isArray(claims)
      ? claims as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function createAuthRuntime(options: UseAuthOptions): AuthState
export function createAuthRuntime(
  runtime: VueApolloRuntime,
  options: UseAuthOptions
): AuthState
export function createAuthRuntime(
  runtimeOrOptions: VueApolloRuntime | UseAuthOptions,
  explicitOptions?: UseAuthOptions
): AuthState {
  let explicitRuntime: VueApolloRuntime | null
  let options: UseAuthOptions
  if (isApolloRuntime(runtimeOrOptions)) {
    explicitRuntime = runtimeOrOptions
    options = explicitOptions!
  } else {
    explicitRuntime = null
    options = runtimeOrOptions
  }
  if (!options?.useMeQuery && !options?.meQuery) {
    throw new Error('[useAuth] `useMeQuery` is required in the auth configuration.')
  }

  const resolveRuntime = () => explicitRuntime || useApolloRuntime()
  const runtimeOptions = () => {
    if (explicitRuntime) return explicitRuntime.options || ({} as any)
    try {
      return useApolloRuntime().options || ({} as any)
    } catch {
      // Legacy createAuthRuntime(options) may be called before app install.
      return {} as any
    }
  }
  const clientId = options.clientId || 'default'
  const boundary = options.authBoundary ||
    runtimeOptions().authBoundary ||
    `${clientId}:${options.tokenKey || runtimeOptions().tokenKey || 'token'}`
  const configuredSessionMode = () =>
    options.sessionMode ||
    runtimeOptions().sessionMode ||
    runtimeOptions().auth?.sessionMode
  const configuredSessionClear = () =>
    options.clearSession || runtimeOptions().auth?.clearSession
  if (
    configuredSessionMode() === 'cookie' &&
    typeof configuredSessionClear() !== 'function'
  ) {
    throw new Error(
      '[useAuth] Cookie-backed sessions require `auth.clearSession` to terminate the authoritative server session.'
    )
  }

  let states: Map<string, AuthInternalState>
  if (explicitRuntime) {
    states = runtimeStates.get(explicitRuntime) ?? new Map()
    runtimeStates.set(explicitRuntime, states)
  } else if (typeof window === 'undefined') {
    // Never use process-global auth state for a server render. Advanced SSR
    // callers should pass their request runtime explicitly when constructing
    // auth outside an application context.
    states = new Map()
  } else {
    states = configuredStates
  }
  const existing = states.get(boundary)
  if (existing) return existing

  const user = ref<any | null>(options.initialUser ?? null)
  const state: AuthInternalState = {
    user,
    isAuthenticated: computed(() => Boolean(user.value)),
    loading: ref(false),
    error: ref(null),
    inflight: null,
    inflightId: null,
    nextVerificationId: 0,
    transitionPromise: null,
    teardownPromise: null,
    tearingDown: false,
    expiredNavigation: null,
    sessionVersion: 0,
    hydratedVerificationPending: Boolean(options.initialAuthHydrated),
    verify: async () => false,
    verifySession: async () => false,
    setSession: async () => undefined,
    clearSession: async () => undefined,
    logout: async () => undefined,
    getTokenClaims: () => null,
    can: () => false,
    reset: () => undefined,
  }
  authInternals.set(state, state)

  const tokenKey = () => options.tokenKey || runtimeOptions().tokenKey || 'token'
  const tokenCookie = () => runtimeOptions().tokenCookie
  const readToken = () => {
    const runtime = resolveRuntime()
    if (runtime.server) return readRequestToken(runtime, tokenKey())
    const customReader = options.getToken || runtimeOptions().getToken
    return customReader ? customReader() : getToken(tokenKey(), tokenCookie())
  }
  const usesCustomTokenStore = () => Boolean(
    options.getToken || runtimeOptions().getToken ||
    options.setToken || runtimeOptions().setToken ||
    options.clearToken || runtimeOptions().clearToken
  )

  const clearCredentials = async () => {
    const runtime = resolveRuntime()
    if (runtime.server) {
      // A server render has no browser cookie store. Request credentials are
      // immutable input; clear only this runtime's user/cache state.
      return
    }
    if (configuredSessionMode() === 'cookie') {
      const clear = configuredSessionClear()
      // This is intentionally not a best-effort local cookie removal: the
      // authoritative server-managed session must be terminated explicitly.
      if (typeof clear !== 'function') {
        throw new Error(
          '[useAuth] Cookie-backed sessions require `auth.clearSession` to terminate the authoritative server session.'
        )
      }
      await clear()
      return
    }
    const refresh = runtimeOptions().refresh
    if (refresh?.clearTokens) {
      await refresh.clearTokens()
      return
    }
    const clear = options.clearToken || runtimeOptions().clearToken
    if (clear) {
      await clear()
      return
    }
    if (usesCustomTokenStore()) return
    if (!runtime.server) removeToken(tokenKey(), tokenCookie())
  }

  const teardown = async () => {
    // A teardown may be followed by a session replacement and then another
    // teardown. Only deduplicate while the original teardown is still the
    // newest transition; once another transition owns the chain, this clear
    // must enqueue its own cleanup after it.
    if (
      state.teardownPromise &&
      state.transitionPromise === state.teardownPromise
    ) return state.teardownPromise
    state.tearingDown = true
    state.sessionVersion += 1
    const version = state.sessionVersion
    try {
      resolveRuntime().credentialCoordinator?.bumpEpoch()
    } catch {
      // Legacy runtime may not be installed yet.
    }
    // Invalidate the old request immediately. Verification callers must wait
    // for the authoritative teardown instead of reusing this work.
    state.loading.value = false
    state.inflight = null
    state.inflightId = null
    const previousTransition = state.transitionPromise
    let promise: Promise<void>
    promise = (async () => {
      if (previousTransition) {
        try {
          await previousTransition
        } catch {
          // Teardown still attempts to remove credentials after a failed
          // session-establishment transition.
        }
      }
      let credentialError: unknown
      try {
        const coordinator = resolveRuntime().credentialCoordinator
        if (coordinator) {
          await coordinator.runExclusive(clearCredentials)
        } else {
          await clearCredentials()
        }
      } catch (error) {
        credentialError = error
      }
      try {
        await resolveRuntime().clearStore(clientId)
      } catch {
        // Session teardown continues even if cache cleanup is unavailable.
      }
      // A newer transition may have started while this teardown was waiting.
      // Do not clear the newer session's user or verification state.
      if (version === state.sessionVersion) {
        state.user.value = null
        state.error.value = null
        state.loading.value = false
        state.inflight = null
        state.inflightId = null
        state.hydratedVerificationPending = false
      }
      if (credentialError) throw credentialError
    })().finally(() => {
      state.tearingDown = false
      if (state.teardownPromise === promise) state.teardownPromise = null
      if (state.transitionPromise === promise) state.transitionPromise = null
    })
    state.teardownPromise = promise
    state.transitionPromise = promise
    return promise
  }

  const awaitCurrentTransition = async () => {
    const transition = state.transitionPromise
    if (!transition) return
    try {
      await transition
    } catch {
      // The verification result remains neutral when a superseding
      // transition fails; the transition's own caller receives the error.
    }
  }

  const hasSessionCredentials = () => {
    const runtime = resolveRuntime()
    if (runtime.server) return true
    if (configuredSessionMode() === 'cookie') return true
    return Boolean(readToken() || state.user.value)
  }

  const runVerification = (): Promise<VerificationResult> => {
    if (state.teardownPromise) {
      return state.teardownPromise.then(() => runVerification())
    }
    if (state.transitionPromise) {
      return state.transitionPromise.then(() => runVerification())
    }
    if (state.inflight) return state.inflight
    if (state.hydratedVerificationPending) {
      state.hydratedVerificationPending = false
      return Promise.resolve({ valid: Boolean(state.user.value), expired: false })
    }
    if (!hasSessionCredentials()) {
      state.user.value = null
      state.error.value = null
      return Promise.resolve({ valid: false, expired: false })
    }
    state.loading.value = true
    state.error.value = null
    const runtime = resolveRuntime()
    const version = state.sessionVersion
    const verificationId = ++state.nextVerificationId
    const useMeQuery = options.useMeQuery
    const meQuery = options.meQuery
    const execution = useMeQuery
      ? executeGeneratedAuthQuery(runtime, useMeQuery, clientId)
      : runtime.executeQuery<any>({
          clientId,
          document: meQuery!,
          fetchPolicy: 'network-only',
          errorPolicy: 'none',
        })
    const promise = execution.then(async ({ data }) => {
      if (version !== state.sessionVersion) {
        await awaitCurrentTransition()
        return { valid: Boolean(state.user.value), expired: false }
      }
      const currentUser = options.meSelector
        ? options.meSelector(data)
        : (data as any)?.me
      if (!currentUser) {
        await teardown()
        return { valid: false, expired: true }
      }
      state.user.value = currentUser
      state.error.value = null
      return { valid: true, expired: false }
    }).catch(async (error) => {
      if (version !== state.sessionVersion) {
        await awaitCurrentTransition()
        return { valid: Boolean(state.user.value), expired: false }
      }
      state.error.value = error
      if (isAuthError(error)) {
        await teardown()
        return { valid: false, expired: true }
      }
      // An ordinary GraphQL/network failure does not prove the session
      // invalid. Propagate it so consumer middleware cannot turn an unknown
      // verification result into a misleading login redirect.
      throw error
    }).finally(() => {
      // Session replacement, teardown, or reset may have invalidated this
      // request while a newer verification is already running. Only the
      // verification that currently owns the bookkeeping may clear it.
      if (state.inflightId !== verificationId) return
      state.loading.value = false
      state.inflight = null
      state.inflightId = null
    })
    state.inflightId = verificationId
    state.inflight = promise
    return promise
  }

  const persistSession = async (session: AuthSession) => {
    const runtime = resolveRuntime()
    if (runtime.server) return
    const refresh = runtimeOptions().refresh
    if (!session.token) {
      const customPersist = options.setToken || runtimeOptions().setToken
      if (customPersist) await customPersist(session)
      return
    }
    if (refresh?.persistTokens) {
      await refresh.persistTokens({
        token: session.token,
        refreshToken: session.refreshToken,
      })
      return
    }
    const customPersist = options.setToken || runtimeOptions().setToken
    if (customPersist) {
      await customPersist(session)
      return
    }
    if (usesCustomTokenStore()) {
      throw new Error(
        '[useAuth] A custom token store must provide `setToken` to establish a session.'
      )
    }
    if (!runtime.server) {
      // Avoid retaining a refresh credential from the previous session when a
      // login response intentionally establishes access-token-only auth.
      if (!session.refreshToken) removeToken(tokenKey(), tokenCookie())
      setCookieToken({
        key: tokenKey(),
        token: session.token,
        refreshToken: session.refreshToken || undefined,
        options: tokenCookie(),
      })
    }
  }

  state.verifySession = async () => (await runVerification()).valid
  state.verify = async () => {
    const result = await runVerification()
    if (!result.valid && result.expired && options.autoNavigate !== false) {
      const navigation = state.expiredNavigation ??= (async () => {
        const loginRoute = options.loginRoute || '/login'
        const separator = loginRoute.includes('?') ? '&' : '?'
        await navigate(
          `${loginRoute}${separator}reason=${options.sessionExpiredReason || 'session_expired'}`,
          options
        )
      })().finally(() => {
        state.expiredNavigation = null
      })
      await navigation
    }
    return result.valid
  }
  state.setSession = async (session) => {
    const previousTransition = state.transitionPromise
    state.sessionVersion += 1
    const version = state.sessionVersion
    try {
      resolveRuntime().credentialCoordinator?.bumpEpoch()
    } catch {
      // Legacy runtime may not be installed yet.
    }
    state.hydratedVerificationPending = false
    state.user.value = null
    state.error.value = null
    state.loading.value = false
    state.inflight = null
    state.inflightId = null
    const promise = (async () => {
      if (previousTransition) {
        try {
          await previousTransition
        } catch {
          // A failed earlier session transition must not abort a newer
          // independent login; the earlier caller still receives its own error.
        }
      }
      try {
        await resolveRuntime().clearStore(clientId)
      } catch {
        // Establishing a session must still succeed when cache cleanup is best effort.
      }
      const coordinator = resolveRuntime().credentialCoordinator
      if (coordinator) {
        await coordinator.runExclusive(() => persistSession(session))
      } else {
        await persistSession(session)
      }
      if (version === state.sessionVersion && session.user !== undefined) {
        state.user.value = session.user
      }
    })()
    state.transitionPromise = promise
    try {
      await promise
    } finally {
      if (state.transitionPromise === promise) state.transitionPromise = null
    }
  }
  state.clearSession = async () => {
    await teardown()
  }
  state.logout = async (navigateOverride) => {
    await state.clearSession()
    const hasExplicitNavigation = Boolean(
      navigateOverride || options.navigate
    )
    if (hasExplicitNavigation || options.autoNavigate !== false) {
      await navigate(options.loginRoute || '/login', options, navigateOverride)
    }
  }
  state.getTokenClaims = () => {
    try {
      return decodeTokenClaims(readToken())
    } catch {
      return null
    }
  }
  state.can = (permission) => {
    if (!state.user.value) return false
    const selector = options.permissions || runtimeOptions().auth?.permissions
    const available = selector?.(state.user.value) || []
    const required = Array.isArray(permission) ? permission : [permission]
    return required.some((entry) =>
      typeof entry === 'string' && (available as readonly unknown[]).includes(entry)
    )
  }
  state.reset = () => {
    state.sessionVersion += 1
    state.user.value = null
    state.error.value = null
    state.loading.value = false
    state.inflight = null
    state.inflightId = null
    state.expiredNavigation = null
    state.hydratedVerificationPending = false
    state.tearingDown = false
  }
  states.set(boundary, state)
  return state
}

/** Internal installed-runtime hydration hook. It restores no credentials. */
export const restoreAuthState = (
  auth: AuthState,
  hydration: VueApolloAuthHydrationState | null | undefined,
): void => {
  const internal = authInternals.get(auth)
  if (!internal || !hydration || !Object.prototype.hasOwnProperty.call(hydration, 'user')) {
    return
  }
  internal.user.value = hydration.user ?? null
  internal.error.value = null
  internal.hydratedVerificationPending = hydration.user != null
}

/**
 * Resolve auth belonging to the currently installed Vue/Apollo application.
 * Passing options remains available for lower-level compatibility integrations.
 */
export function useAuth(): AuthState
export function useAuth(options: UseAuthOptions): AuthState
export function useAuth(options?: UseAuthOptions): AuthState {
  const runtime = useApolloRuntime()
  if (options) return createAuthRuntime(runtime, options)
  if (!runtime.auth) {
    throw new Error(
      '[useAuth] No auth configuration is installed. Add `auth: { useMeQuery }` to defineApollo().'
    )
  }
  return runtime.auth
}
