import { unref, computed, effectScope, ref, type ComputedRef, type Ref } from 'vue'
import {
  useApolloRuntime,
  type VueApolloRuntime,
} from '../createApollo'
import { decodeTokenClaims, sameCredentialOwner, type CredentialOwnership } from '../ApolloSessionRuntime'
import { verificationDeadline, executeWithAbort } from '../ApolloOperationRuntime'
import type { DocumentNode } from 'graphql'
import {
  getCookieValueFromHeader,
  getToken,
  getRefreshToken,
  removeToken,
  setToken as setCookieToken,
} from './useCookies'
import type {
  AuthSession,
  AuthVerificationEvent,
  VueApolloAuthHydrationState,
  VueApolloAuthOptions,
} from '../types'

export interface UseAuthOptions extends VueApolloAuthOptions {
  /** Internal initial state supplied by the installed runtime. */
  initialUser?: any | null
  /** Internal compatibility switch; installed auth does not navigate implicitly. */
  autoNavigate?: boolean
}

export interface GeneratedAuthQuery {
  refetch?: () => Promise<{ data?: any }> | undefined
  document?: Ref<DocumentNode>
  options?: { context?: Record<string, any>; clientId?: string } | Ref<{ context?: Record<string, any>; clientId?: string }>
  variables?: Ref<Record<string, unknown>>
  result?: Ref<any>
  loading?: Ref<boolean>
  onResult: (callback: (result: { data?: any; loading?: boolean }) => void) => {
    off: () => void
  }
  onError: (callback: (error: any) => void) => { off: () => void }
  stop?: () => void
}

export interface AuthState {
  status: ComputedRef<'unknown' | 'verifying' | 'authenticated' | 'anonymous' | 'unavailable'>
  user: Ref<any | null>
  isAuthenticated: ComputedRef<boolean>
  loading: Ref<boolean>
  error: Ref<any | null>
  /** Legacy verification that redirects after an expired session. */
  verify: () => Promise<boolean>
  /** Session verification primitive; never performs navigation. */
  verifySession: (options?: { signal?: AbortSignal }) => Promise<boolean>
  /** Establish a token or already-established server-managed session. */
  setSession: (session: AuthSession, options?: { signal?: AbortSignal }) => Promise<void>
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
  expiredNavigation: Promise<void> | null
  sessionVersion: number
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
  signal: AbortSignal,
): Promise<{ data?: any }> => {
  const scope = effectScope()
  const enabled = ref(false)
  const instantiate = () => scope.run(() => createQuery({
    clientId, enabled, fetchPolicy: 'no-cache', errorPolicy: 'none',
  })) as GeneratedAuthQuery
  let query: GeneratedAuthQuery | undefined
  try {
    const instance = query = runtime.runWithContext ? runtime.runWithContext(instantiate) : instantiate()
    if (instance.document?.value) {
      const queryOptions = unref(instance.options)
      return await runtime.executeQuery({
        clientId: queryOptions?.clientId ?? clientId, document: instance.document.value, variables: instance.variables?.value,
        fetchPolicy: 'no-cache', errorPolicy: 'none', context: { ...queryOptions?.context, queryDeduplication: false }, signal,
      })
    }
    // A watch event may originate from the cache. A third-party adapter must
    // expose its document or a network refetch promise to prove authority.
    const network = instance.refetch?.()
    if (network) return await executeWithAbort(signal, undefined, () => network)
    throw new Error('The session query must expose its document or a network refetch.')
  } finally {
    query?.stop?.()
    scope.stop()
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
  const settled = ref(false)
  let verificationController: AbortController | undefined
  const state: AuthInternalState = {
    status: computed(() => state.loading.value ? 'verifying' : state.error.value ? 'unavailable'
      : !settled.value ? 'unknown' : state.user.value ? 'authenticated' : 'anonymous'),
    user,
    isAuthenticated: computed(() => Boolean(user.value)),
    loading: ref(false),
    error: ref(null),
    inflight: null,
    inflightId: null,
    nextVerificationId: 0,
    transitionPromise: null,
    teardownPromise: null,
    expiredNavigation: null,
    sessionVersion: 0,
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

  // Keep the barrier until the actual adapter/cache work settles, even when
  // the caller has timed out. An abort cannot undo an external write.
  let writer: Promise<void> | undefined
  let stalledWriter = false
  const transition = (session?: AuthSession, callerSignal?: AbortSignal): Promise<void> => {
    if (stalledWriter) return Promise.reject(new Error('The previous session writer is still pending. Retry when it settles.'))
    if (!session && state.teardownPromise && state.teardownPromise === state.transitionPromise) return state.teardownPromise
    const runtime = resolveRuntime()
    const previous = writer
    const endManaged = session ? undefined : runtime.captureBrowserLogout?.()
    const version = ++state.sessionVersion
    runtime.credentialCoordinator?.bumpEpoch()
    state.user.value = null
    state.error.value = null
    settled.value = false
    state.loading.value = false
    state.inflight = null
    state.inflightId = null
    const timeout = verificationDeadline(options.verificationTimeoutMs ?? runtimeOptions().requestTimeoutMs)
    let raw: Promise<void> | undefined
    const completion = executeWithAbort(callerSignal, timeout, signal => {
      const check = () => {
        signal!.throwIfAborted()
        if (session && state.sessionVersion !== version) throw new Error('Sign-in was superseded.')
      }
      const change = async () => {
        check()
        if (session) {
          await runtime.clearStore()
          check()
          await persistSession(session, signal!)
          check()
          if (runtime.prepareBrowserSession && !capture().sessionKey) throw new Error('Sign-in was superseded.')
          if (session.user !== undefined) {
            state.user.value = session.user
            verifiedOwner = capture()
            settled.value = true
          }
        } else {
          try {
            await (endManaged ?? clearCredentials)()
          } finally {
            await runtime.clearStore()
          }
          if (version === state.sessionVersion) settled.value = true
        }
      }
      raw = (async () => {
        if (previous) await previous.catch(() => undefined)
        check()
        if (runtime.credentialCoordinator) await runtime.credentialCoordinator.runExclusive(change)
        else await change()
      })().finally(() => {
        if (writer === raw) { writer = undefined; stalledWriter = false }
      })
      writer = raw
      return raw
    }).catch(error => {
      if (raw && writer === raw) stalledWriter = true
      if (version === state.sessionVersion) state.error.value = error
      throw error
    }).finally(() => {
      if (state.transitionPromise === completion) state.transitionPromise = null
      if (state.teardownPromise === completion) state.teardownPromise = null
    })
    state.transitionPromise = completion
    if (!session) state.teardownPromise = completion
    return completion
  }
  const teardown = () => transition()

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

  const capture = (): CredentialOwnership => {
    const runtime = resolveRuntime()
    if (runtime.credentialCoordinator?.capture) return runtime.credentialCoordinator.capture()
    return {
      accessToken: readToken() || '',
      refreshToken: runtimeOptions().refresh?.getRefreshToken?.() ||
        (!usesCustomTokenStore() && !runtime.server ? getRefreshToken(tokenKey(), tokenCookie()) || '' : ''),
      sessionKey: runtimeOptions().getSessionId?.() ?? null,
      epoch: runtime.credentialCoordinator?.getEpoch() ?? 0,
    }
  }

  const purgeLocalCache = () => {
    const runtime = resolveRuntime()
    return runtime.purgeSessionCaches ? runtime.purgeSessionCaches() : runtime.clearStore()
  }
  let verifiedOwner: CredentialOwnership | undefined
  const deadline = () => performance.now() + verificationDeadline(options.verificationTimeoutMs ?? runtimeOptions().requestTimeoutMs)
  const remaining = (endsAt: number) => Math.max(1, Math.ceil(endsAt - performance.now()))
  const waitUntil = <T>(promise: Promise<T>, endsAt: number) =>
    executeWithAbort(undefined, remaining(endsAt), () => promise)
  const runVerification = (reconciled = false, endsAt = deadline()): Promise<VerificationResult> => {
    if (stalledWriter) return Promise.reject(new Error('Session writer recovery is pending.'))
    if (state.teardownPromise) {
      return waitUntil(state.teardownPromise, endsAt).then(() => runVerification(reconciled, endsAt))
    }
    if (state.transitionPromise) {
      return waitUntil(state.transitionPromise, endsAt).then(() => runVerification(reconciled, endsAt))
    }
    if (state.inflight) return state.inflight
    const owner = capture()
    if (verifiedOwner && !sameCredentialOwner(verifiedOwner, owner) &&
        !(owner.sessionKey && owner.sessionKey === verifiedOwner.sessionKey && owner.epoch === verifiedOwner.epoch)) state.user.value = null
    if (!resolveRuntime().server && configuredSessionMode() !== 'cookie' && !owner.accessToken && !owner.refreshToken) {
      state.user.value = null
      state.error.value = null
      settled.value = true
      verifiedOwner = owner
      const version = state.sessionVersion
      return waitUntil(purgeLocalCache(), endsAt).then(() => {
        if (version !== state.sessionVersion || !sameCredentialOwner(owner, capture())) {
          if (reconciled) throw new Error('Session changed during verification.')
          return runVerification(true, endsAt)
        }
        return { valid: false, expired: false }
      })
    }
    state.loading.value = true
    state.error.value = null
    const runtime = resolveRuntime()
    const version = state.sessionVersion
    const verificationId = ++state.nextVerificationId
    const useMeQuery = options.useMeQuery
    const meQuery = options.meQuery
    const controller = verificationController = new AbortController()
    const execution = executeWithAbort(controller.signal,
      remaining(endsAt),
      signal => meQuery ? runtime.executeQuery<any>({
        clientId, document: meQuery, fetchPolicy: 'no-cache', errorPolicy: 'none',
        context: { queryDeduplication: false }, signal,
      }) : executeGeneratedAuthQuery(runtime, useMeQuery!, clientId, signal!))
    const reconcile = async () => {
      const active = capture()
      if (!owner.sessionKey || owner.sessionKey !== active.sessionKey || owner.epoch !== active.epoch) state.user.value = null
      settled.value = false
      if (reconciled) throw new Error('The session changed during verification. Try again.')
      state.inflight = null
      if (runtime.prepareBrowserSession) {
        if (!await executeWithAbort(controller.signal, remaining(endsAt), signal => runtime.prepareBrowserSession!(signal!))) {
          await waitUntil(purgeLocalCache(), endsAt)
          if (version !== state.sessionVersion) throw new Error('Verification superseded.')
          settled.value = true
          return { valid: false, expired: false }
        }
      }
      return runVerification(true, endsAt)
    }
    const invalidate = async (): Promise<VerificationResult> => {
      if (version !== state.sessionVersion || !sameCredentialOwner(owner, capture())) return reconcile()
      if (configuredSessionMode() === 'cookie' || runtime.server) {
        const authority = runtime.credentialCoordinator
        const clear = async () => {
          if (version !== state.sessionVersion || !sameCredentialOwner(owner, capture())) return false
          const epoch = authority?.bumpEpoch()
          state.user.value = null
          const local = runtime.forgetBrowserSession ?? options.clearToken ?? runtimeOptions().clearToken
          await Promise.all([purgeLocalCache(), !runtime.server && local?.()])
          const active = capture()
          return version === state.sessionVersion && (epoch === undefined || active.epoch === epoch) &&
            (!active.sessionKey || active.sessionKey === owner.sessionKey) &&
            (!active.accessToken || active.accessToken === owner.accessToken)
        }
        if (!await waitUntil(authority ? authority.runExclusive(clear) : clear(), endsAt)) {
          if (version === state.sessionVersion) return reconcile()
          await waitUntil(awaitCurrentTransition(), endsAt)
          return { valid: !!state.user.value, expired: false }
        }
      } else {
        const authority = runtime.credentialCoordinator
        if (authority?.invalidate) {
          if (!await waitUntil(authority.invalidate(owner), endsAt)) {
            if (!sameCredentialOwner(owner, capture())) return reconcile()
            await waitUntil(purgeLocalCache(), endsAt)
          }
        } else if (sameCredentialOwner(owner, capture())) {
          await waitUntil(teardown(), endsAt)
          return { valid: false, expired: true }
        } else return reconcile()
      }
      if (version !== state.sessionVersion) {
        await waitUntil(awaitCurrentTransition(), endsAt)
        return { valid: !!state.user.value, expired: false }
      }
      state.user.value = null
      verifiedOwner = capture()
      settled.value = true
      return { valid: false, expired: true }
    }
    const promise = execution.then(async ({ data }) => {
      if (version !== state.sessionVersion) {
        await waitUntil(awaitCurrentTransition(), endsAt)
        return { valid: Boolean(state.user.value), expired: false }
      }
      if (!sameCredentialOwner(owner, capture())) return reconcile()
      const currentUser = options.meSelector
        ? options.meSelector(data)
        : (data as any)?.me
      if (!currentUser) return invalidate()
      verifiedOwner = owner
      settled.value = true
      state.user.value = currentUser
      state.error.value = null
      return { valid: true, expired: false }
    }, async (error) => {
      if (version !== state.sessionVersion) {
        await waitUntil(awaitCurrentTransition(), endsAt)
        return { valid: Boolean(state.user.value), expired: false }
      }
      if (!sameCredentialOwner(owner, capture())) return reconcile()
      if (isAuthError(error)) return invalidate()
      state.error.value = error
      // An ordinary GraphQL/network failure does not prove the session
      // invalid. Propagate it so consumer middleware cannot turn an unknown
      // verification result into a misleading login redirect.
      throw error
    }).finally(() => {
      // Session replacement, teardown, or reset may have invalidated this
      // request while a newer verification is already running. Only the
      // verification that currently owns the bookkeeping may clear it.
      if (verificationController === controller) verificationController = undefined
      if (state.inflightId !== verificationId) return
      state.loading.value = false
      state.inflight = null
      state.inflightId = null
    })
    state.inflightId = verificationId
    state.inflight = promise
    return promise
  }

  const persistSession = async (session: AuthSession, signal: AbortSignal) => {
    const runtime = resolveRuntime()
    if (runtime.server) return
    const refresh = runtimeOptions().refresh
    if (!session.token) {
      const customPersist = options.setToken || runtimeOptions().setToken
      if (customPersist) await customPersist(session, { signal })
      return
    }
    if (refresh?.persistTokens) {
      await refresh.persistTokens({
        token: session.token,
        refreshToken: session.refreshToken,
      }, { signal })
      return
    }
    const customPersist = options.setToken || runtimeOptions().setToken
    if (customPersist) {
      await customPersist(session, { signal })
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

  let preparation: Promise<VerificationResult> | undefined
  const verifyCurrent = (endsAt = deadline()): Promise<VerificationResult> => {
    const runtime = resolveRuntime()
    if (stalledWriter) return Promise.reject(new Error('Session writer recovery is pending.'))
    if (!runtime.prepareBrowserSession) return runVerification(false, endsAt)
    if (state.transitionPromise) return waitUntil(state.transitionPromise, endsAt).then(() => verifyCurrent(endsAt))
    if (preparation) return preparation
    const version = state.sessionVersion
    state.loading.value = true
    const controller = verificationController = new AbortController()
    const previous = capture()
    const work = executeWithAbort(controller.signal, remaining(endsAt),
      signal => runtime.prepareBrowserSession!(signal!)).then(async present => {
      if (version !== state.sessionVersion) {
        await waitUntil(awaitCurrentTransition(), endsAt)
        return { valid: Boolean(state.user.value), expired: false }
      }
      if ((verifiedOwner?.sessionKey ?? previous.sessionKey) !== capture().sessionKey || (!present && state.user.value)) {
        state.user.value = null
        await waitUntil(purgeLocalCache(), endsAt)
        if (version !== state.sessionVersion || controller.signal.aborted) throw new Error('Verification superseded.')
      }
      if (!present) {
        verifiedOwner = capture()
        state.user.value = null
        state.error.value = null
        await waitUntil(purgeLocalCache(), endsAt)
        if (version !== state.sessionVersion) throw new Error('Verification superseded.')
        settled.value = true
        return { valid: false, expired: false }
      }
      return runVerification(false, endsAt)
    }).catch(error => {
      if (version === state.sessionVersion) state.error.value = error
      throw error
    }).finally(() => {
      if (preparation === work) preparation = undefined
      if (verificationController === controller) verificationController = undefined
      if (version === state.sessionVersion && !state.inflight) state.loading.value = false
    })
    preparation = work
    return work
  }
  const observations = new WeakMap<Promise<VerificationResult>, Promise<VerificationResult>>()
  const verifyObserved = () => {
    const verification = verifyCurrent()
    if (!options.onVerification) return verification
    const existing = observations.get(verification)
    if (existing) return existing
    const started = performance.now()
    const report = (outcome: AuthVerificationEvent['outcome'], httpStatus?: number) => {
      try { options.onVerification?.({ outcome, durationMs: Math.round(performance.now() - started), httpStatus }) }
      catch { /* Diagnostics cannot change session state. */ }
    }
    const work = verification.then(result => {
      report(result.valid ? 'authenticated' : result.expired ? 'revoked' : 'anonymous')
      return result
    }, error => {
      const cause = error?.networkError ?? error
      const status = cause?.statusCode ?? cause?.status
      const codes = error?.graphQLErrors?.map((item: any) => item.extensions?.code) ?? []
      report(cause?.name === 'TimeoutError' ? 'timeout' : cause?.name === 'AbortError' ? 'cancelled'
        : status === 429 ? 'rate-limited' : status === 403 || codes.includes('FORBIDDEN') ? 'forbidden'
        : codes.includes('REFRESH_SUPERSEDED') ? 'refresh-conflict' : status >= 500 ? 'unavailable'
        : error?.networkError || cause instanceof TypeError ? 'network-error' : 'application-error',
        typeof status === 'number' ? status : undefined)
      throw error
    })
    observations.set(verification, work)
    return work
  }
  state.verifySession = async (wait = {}) =>
    (await executeWithAbort(wait.signal, undefined, () => verifyObserved())).valid
  state.verify = async () => {
    const result = await verifyObserved()
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
  state.setSession = (session, wait) => transition(session, wait?.signal)
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
    preparation = undefined
    verificationController?.abort()
    settled.value = false
    verifiedOwner = undefined
    state.user.value = null
    state.error.value = null
    state.loading.value = false
    state.inflight = null
    state.inflightId = null
    state.expiredNavigation = null
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
