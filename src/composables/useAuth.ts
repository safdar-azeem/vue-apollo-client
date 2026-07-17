import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  useApolloRuntime,
  type VueApolloRuntime,
} from '../createApollo'
import { getToken, removeToken } from './useCookies'

export interface UseAuthOptions {
  meQuery: any
  meSelector?: (data: any) => any
  loginRoute?: string
  sessionExpiredReason?: string
  clientId?: string
  authBoundary?: string
  tokenKey?: string
  getToken?: () => string | null | undefined
  clearToken?: () => void | Promise<void>
  navigate?: (path: string) => void | Promise<void>
}

export interface AuthState {
  user: Ref<any | null>
  isAuthenticated: ComputedRef<boolean>
  loading: Ref<boolean>
  error: Ref<any | null>
  verify: () => Promise<boolean>
  logout: () => Promise<void>
  reset: () => void
}

interface AuthInternalState extends AuthState {
  inflight: Promise<boolean> | null
  tearingDown: boolean
}

const runtimeStates = new WeakMap<
  VueApolloRuntime,
  Map<string, AuthInternalState>
>()
let compatibilityRouter: any = null

/** @deprecated Pass `navigate` to `createAuthRuntime` instead. */
export const setAuthRouter = (router: any) => {
  compatibilityRouter = router
}

const isAuthError = (error: any): boolean => {
  const graphQLErrors: any[] = error?.graphQLErrors || []
  if (graphQLErrors.some((entry: any) =>
    entry?.extensions?.code === 'UNAUTHENTICATED' ||
    entry?.extensions?.code === 'FORBIDDEN' ||
    /unauthori[sz]ed/i.test(entry?.message ?? '') ||
    /user not found/i.test(entry?.message ?? '')
  )) return true
  const statusCode =
    error?.networkError?.statusCode ?? error?.networkError?.result?.status
  return statusCode === 401 || statusCode === 403
}

const navigate = async (path: string, options: UseAuthOptions) => {
  if (typeof window === 'undefined') return
  if (options.navigate) return void await options.navigate(path)
  if (compatibilityRouter?.push) return void await compatibilityRouter.push(path)
  window.location.assign(path)
}

export const createAuthRuntime = (
  runtime: VueApolloRuntime,
  options: UseAuthOptions
): AuthState => {
  if (!options?.meQuery) throw new Error('[useAuth] `meQuery` is required')
  const clientId = options.clientId || 'default'
  const boundary = options.authBoundary || `${clientId}:${options.tokenKey || 'token'}`
  let states = runtimeStates.get(runtime)
  if (!states) {
    states = new Map()
    runtimeStates.set(runtime, states)
  }
  const existing = states.get(boundary)
  if (existing) return existing

  const user = ref<any | null>(null)
  const state: AuthInternalState = {
    user,
    isAuthenticated: computed(() => Boolean(user.value)),
    loading: ref(false),
    error: ref(null),
    inflight: null,
    tearingDown: false,
    verify: async () => false,
    logout: async () => undefined,
    reset: () => undefined,
  }
  const readToken = () => options.getToken
    ? options.getToken()
    : getToken(options.tokenKey)
  const clearToken = async () => {
    if (options.clearToken) await options.clearToken()
    else removeToken(options.tokenKey)
  }
  const teardown = async (reason: 'session_expired' | 'logout') => {
    if (state.tearingDown) return
    state.tearingDown = true
    await clearToken()
    try {
      await runtime.clearStore(clientId)
    } catch {
      // Session teardown must continue even when cache cleanup fails.
    }
    state.user.value = null
    state.error.value = null
    state.inflight = null
    const loginRoute = options.loginRoute || '/login'
    if (reason === 'session_expired') {
      const separator = loginRoute.includes('?') ? '&' : '?'
      await navigate(
        `${loginRoute}${separator}reason=${options.sessionExpiredReason || 'session_expired'}`,
        options
      )
    } else {
      await navigate(loginRoute, options)
    }
  }

  state.verify = () => {
    if (state.inflight) return state.inflight
    if (!readToken()) {
      state.user.value = null
      return Promise.resolve(false)
    }
    if (state.tearingDown) state.tearingDown = false
    state.loading.value = true
    const promise = runtime.executeQuery<any>({
      clientId,
      document: options.meQuery,
      fetchPolicy: 'network-only',
      errorPolicy: 'none',
    }).then(async ({ data }) => {
      const currentUser = options.meSelector
        ? options.meSelector(data)
        : (data as any)?.me
      if (!currentUser) {
        await teardown('session_expired')
        return false
      }
      state.user.value = currentUser
      return true
    }).catch(async (error) => {
      state.error.value = error
      if (isAuthError(error)) await teardown('session_expired')
      return false
    }).finally(() => {
      state.loading.value = false
      state.inflight = null
    })
    state.inflight = promise
    return promise
  }
  state.logout = () => teardown('logout')
  state.reset = () => {
    state.user.value = null
    state.error.value = null
    state.inflight = null
    state.tearingDown = false
  }
  states.set(boundary, state)
  return state
}

export const useAuth = (options: UseAuthOptions): AuthState =>
  createAuthRuntime(useApolloRuntime(), options)
