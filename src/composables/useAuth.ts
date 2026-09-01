import { computed, effectScope, ref, type ComputedRef, type Ref } from 'vue'
import {
  useApolloRuntime,
  type VueApolloRuntime,
} from '../createApollo'
import { isApolloStoreResetError } from '../ApolloSessionRuntime'
import { getToken, removeToken } from './useCookies'

export interface UseAuthOptions {
  /** Generated `useMeQuery`-style composable. */
  useMeQuery?: (options?: any) => GeneratedAuthQuery
  /** @deprecated Prefer `useMeQuery`; application code should not import documents. */
  meQuery?: any
  meSelector?: (data: any) => any
  /** Destination used after explicit logout. */
  loginRoute?: string
  /** Query-string reason used by the legacy `verify()` redirect. */
  sessionExpiredReason?: string
  clientId?: string
  authBoundary?: string
  tokenKey?: string
  getToken?: () => string | null | undefined
  clearToken?: () => void | Promise<void>
  /** Navigation used by legacy redirects and explicit logout. */
  navigate?: (path: string) => void | Promise<void>
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
  logout: (navigate?: (path: string) => void | Promise<void>) => Promise<void>
  reset: () => void
}

interface VerificationResult {
  valid: boolean
  expired: boolean
}

interface AuthInternalState extends AuthState {
  inflight: Promise<VerificationResult> | null
  tearingDown: boolean
  expiredNavigation: Promise<void> | null
}

const runtimeStates = new WeakMap<
  VueApolloRuntime,
  Map<string, AuthInternalState>
>()
const configuredStates = new Map<string, AuthInternalState>()
let compatibilityRouter: any = null

/** @deprecated Pass `navigate` to `createAuthRuntime` instead. */
export const setAuthRouter = (router: any) => {
  compatibilityRouter = router
}

const isAuthError = (error: any): boolean => {
  // FORBIDDEN/HTTP 403 belongs to operation authorization. It must not tear
  // down an authenticated session merely because this verification attempt or
  // another field was not permitted.
  const graphQLErrors: any[] = error?.graphQLErrors || []
  if (graphQLErrors.some((entry: any) => {
    const code = entry?.extensions?.code
    if (code === 'UNAUTHENTICATED' || code === 'WORKSPACE_UNAVAILABLE') {
      return true
    }
    if (code) return false
    return /unauthori[sz]ed/i.test(entry?.message ?? '') ||
      /user not found/i.test(entry?.message ?? '')
  })) return true
  const statusCode =
    error?.networkError?.statusCode ?? error?.networkError?.result?.status
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

const executeGeneratedAuthQuery = async (
  runtime: VueApolloRuntime,
  createQuery: NonNullable<UseAuthOptions['useMeQuery']>,
  attempt = 0,
): Promise<{ data?: any }> => {
  const scope = effectScope()
  const query = runtime.runWithContext(() =>
    scope.run(() =>
      createQuery({ fetchPolicy: 'network-only', errorPolicy: 'none' })
    )!
  )
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
      errorSubscription = query.onError((error) =>
        settle(() => reject(error))
      )
      queueMicrotask(() => {
        if (!query.loading?.value && query.result?.value) {
          settle(() => resolve({ data: query.result?.value }))
        }
      })
    })
  } catch (error) {
    // Session-cache isolation can still surface #42 to watchers; retry once so
    // post-login `verify()` does not fail closed and block the dashboard redirect.
    if (isApolloStoreResetError(error) && attempt < 1) {
      return executeGeneratedAuthQuery(runtime, createQuery, attempt + 1)
    }
    throw error
  } finally {
    query.stop?.()
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
    throw new Error('[useAuth] `useMeQuery` is required')
  }
  const clientId = options.clientId || 'default'
  const boundary = options.authBoundary || `${clientId}:${options.tokenKey || 'token'}`
  let states: Map<string, AuthInternalState>
  if (explicitRuntime) {
    states = runtimeStates.get(explicitRuntime) ?? new Map()
    runtimeStates.set(explicitRuntime, states)
  } else {
    states = configuredStates
  }
  const existing = states.get(boundary)
  if (existing) return existing
  const resolveRuntime = () => explicitRuntime || useApolloRuntime()

  const user = ref<any | null>(null)
  const state: AuthInternalState = {
    user,
    isAuthenticated: computed(() => Boolean(user.value)),
    loading: ref(false),
    error: ref(null),
    inflight: null,
    tearingDown: false,
    expiredNavigation: null,
    verify: async () => false,
    verifySession: async () => false,
    logout: async () => undefined,
    reset: () => undefined,
  }
  const readToken = () => options.getToken
    ? options.getToken()
    : getToken(options.tokenKey)
  const clearToken = async () => {
    if (options.clearToken) await options.clearToken()
    else removeToken(options.tokenKey, resolveRuntime().options.tokenCookie)
  }
  const teardown = async () => {
    if (state.tearingDown) return
    state.tearingDown = true
    await clearToken()
    try {
      await resolveRuntime().clearStore(clientId)
    } catch {
      // Session teardown must continue even when cache cleanup fails.
    }
    state.user.value = null
    state.error.value = null
    state.inflight = null
  }

  const runVerification = (): Promise<VerificationResult> => {
    if (state.inflight) return state.inflight
    if (!readToken()) {
      state.user.value = null
      return Promise.resolve({ valid: false, expired: false })
    }
    if (state.tearingDown) state.tearingDown = false
    state.loading.value = true
    const runtime = resolveRuntime()
    const execution = options.useMeQuery
      ? executeGeneratedAuthQuery(runtime, options.useMeQuery)
      : runtime.executeQuery<any>({
          clientId,
          document: options.meQuery,
          fetchPolicy: 'network-only',
          errorPolicy: 'none',
        })
    const promise = execution.then(async ({ data }) => {
      const currentUser = options.meSelector
        ? options.meSelector(data)
        : (data as any)?.me
      if (!currentUser) {
        await teardown()
        return { valid: false, expired: true }
      }
      state.user.value = currentUser
      return { valid: true, expired: false }
    }).catch(async (error) => {
      state.error.value = error
      if (isAuthError(error)) {
        await teardown()
        return { valid: false, expired: true }
      }
      return { valid: false, expired: false }
    }).finally(() => {
      state.loading.value = false
      state.inflight = null
    })
    state.inflight = promise
    return promise
  }
  state.verifySession = async () => (await runVerification()).valid
  state.verify = async () => {
    const result = await runVerification()
    if (!result.valid && result.expired) {
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
  state.logout = async (navigateOverride) => {
    await teardown()
    await navigate(options.loginRoute || '/login', options, navigateOverride)
  }
  state.reset = () => {
    state.user.value = null
    state.error.value = null
    state.inflight = null
    state.expiredNavigation = null
    state.tearingDown = false
  }
  states.set(boundary, state)
  return state
}

export const useAuth = (options: UseAuthOptions): AuthState =>
  createAuthRuntime(useApolloRuntime(), options)
