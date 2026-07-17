import createUploadLink from 'apollo-upload-client/createUploadLink.mjs'
import {
  ApolloClient,
  InMemoryCache,
  type ApolloClientOptions,
  type InMemoryCacheConfig,
  type NormalizedCacheObject,
  from,
  fromPromise,
} from '@apollo/client/core/index.js'
import { onError } from '@apollo/client/link/error/index.js'
import { setContext as setContextLink } from '@apollo/client/link/context/index.js'
import {
  getToken as getCookieToken,
  stashToken,
  restoreStashedToken,
  removeToken,
} from '../composables/useCookies'
import type { VueApolloRuntimeOptions } from '../types'

export type SetGraphqlContext = ({
  operationName,
  variables,
  token,
}: {
  operationName: string
  variables: any
  token: string
}) => Record<string, any>

export type ApolloUploadConfig = Parameters<typeof createUploadLink>[0]

interface ConfigProps {
  endPoints: Record<string, string>
  tokenKey: string
  setContext?: SetGraphqlContext
  memoryConfig?: Partial<InMemoryCacheConfig>
  useGETForQueries?: boolean
  apolloClientConfig?: Partial<ApolloClientOptions<any>> | null
  apolloUploadConfig?: Partial<ApolloUploadConfig>
  refreshToken?: () => Promise<string | void | null>
  onLogout?: () => void
  getToken?: () => string | null | undefined
  clearToken?: () => void
  formatToken?: (token: string) => string
  runtime?: VueApolloRuntimeOptions
}

interface RefreshWaiter {
  resolve: (token: string | null) => void
  reject: (error: unknown) => void
}

const positiveTimeout = (value: number | undefined): number | undefined =>
  Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined

const createRuntimeFetch = (
  runtime: VueApolloRuntimeOptions
): typeof fetch => {
  const baseFetch = runtime.fetch ?? globalThis.fetch
  const timeoutMs = positiveTimeout(runtime.requestTimeoutMs)

  return async (input, init = {}) => {
    if (!baseFetch) throw new Error('No fetch implementation is available for Apollo.')
    if (!timeoutMs && !runtime.signal) return baseFetch(input, init)

    const controller = new AbortController()
    const signals = [runtime.signal, init.signal].filter(Boolean) as AbortSignal[]
    const abort = () => controller.abort()
    for (const signal of signals) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', abort, { once: true })
    }
    const timeout = timeoutMs ? setTimeout(abort, timeoutMs) : undefined

    try {
      return await baseFetch(input, { ...init, signal: controller.signal })
    } finally {
      if (timeout) clearTimeout(timeout)
      for (const signal of signals) signal.removeEventListener('abort', abort)
    }
  }
}

export const graphqlConfig = ({
  endPoints,
  tokenKey,
  setContext,
  memoryConfig,
  useGETForQueries,
  apolloClientConfig,
  apolloUploadConfig,
  refreshToken,
  onLogout,
  getToken,
  clearToken,
  formatToken = (token) => token,
  runtime = {},
}: ConfigProps): Record<string, ApolloClient<NormalizedCacheObject>> => {
  const server = runtime.server ?? typeof window === 'undefined'
  const readToken = (): string | null | undefined =>
    server ? null : getToken ? getToken() : getCookieToken(tokenKey)
  const removeConfiguredToken = () => {
    if (server) return
    if (clearToken) clearToken()
    else removeToken(tokenKey)
  }

  if (!server) restoreStashedToken(tokenKey)

  // Refresh coordination is scoped to this client set. Every SSR request calls
  // graphqlConfig independently, so concurrent users cannot share auth state.
  let isRefreshing = false
  let failedQueue: RefreshWaiter[] = []
  const processQueue = (error: unknown, token: string | null = null) => {
    for (const waiter of failedQueue) {
      if (error) waiter.reject(error)
      else waiter.resolve(token)
    }
    failedQueue = []
  }

  const clients: Record<string, ApolloClient<NormalizedCacheObject>> = {}
  const clearAllStores = () => {
    for (const client of Object.values(clients)) {
      try {
        void client.clearStore().catch(() => undefined)
      } catch {
        // Best-effort browser session cleanup.
      }
    }
  }

  const authLink = setContextLink((operation, previousContext) => {
    const token = readToken() || ''
    const configuredContext = setContext?.({
      operationName: operation.operationName || '',
      variables: operation.variables,
      token,
    })
    const authorization = token ? formatToken(token) : ''

    return {
      ...configuredContext,
      headers: {
        ...runtime.headers,
        ...configuredContext?.headers,
        ...previousContext?.headers,
        ...(authorization ? { authorization } : {}),
      },
    }
  })

  const errorLink = onError(
    ({ graphQLErrors, networkError, operation, forward }) => {
      if (server) return

      if (networkError) {
        const statusCode =
          (networkError as any)?.statusCode ??
          (networkError as any)?.result?.status

        if (statusCode === 401 || statusCode === 403) {
          if (readToken()) {
            removeConfiguredToken()
            clearAllStores()
            onLogout?.()
          }
          return
        }

        const message = String(networkError.message || '')
        const isUnreachable =
          message.includes('Failed to fetch') ||
          message.includes('NetworkError') ||
          message.includes('ECONNREFUSED') ||
          statusCode === 0 ||
          statusCode >= 500

        if (isUnreachable && readToken() && !getToken) {
          // Stashing is a cookie-specific legacy behavior. Custom token stores
          // keep ownership of their own offline policy.
          stashToken(tokenKey)
          onLogout?.()
        }
      }

      const authenticationFailure = graphQLErrors?.some(
        (error) =>
          error.extensions?.code === 'UNAUTHENTICATED' ||
          error.message === 'Unauthorized'
      )
      if (!authenticationFailure || !refreshToken || !readToken()) return

      if (isRefreshing) {
        return fromPromise(
          new Promise<string | null>((resolve, reject) => {
            failedQueue.push({ resolve, reject })
          })
        )
          .filter(Boolean)
          .flatMap((accessToken) => {
            operation.setContext(({ headers = {} }) => ({
              headers: {
                ...headers,
                authorization: formatToken(String(accessToken)),
              },
            }))
            return forward(operation)
          })
      }

      isRefreshing = true
      return fromPromise(
        refreshToken()
          .then((newToken) => {
            if (!newToken) throw new Error('Token refresh returned no access token.')
            processQueue(null, newToken)
            return newToken
          })
          .catch((error) => {
            processQueue(error)
            removeConfiguredToken()
            clearAllStores()
            onLogout?.()
            throw error
          })
          .finally(() => {
            isRefreshing = false
          })
      ).flatMap((accessToken) => {
        operation.setContext(({ headers = {} }) => ({
          headers: {
            ...headers,
            authorization: formatToken(String(accessToken)),
          },
        }))
        return forward(operation)
      })
    }
  )

  const runtimeFetch = createRuntimeFetch(runtime)
  for (const [clientId, endpoint] of Object.entries(endPoints)) {
    const uploadHeaders = {
      'Apollo-Require-Preflight': 'true',
      ...(apolloUploadConfig?.headers as Record<string, string> | undefined),
      ...runtime.headers,
    }
    const httpLink = createUploadLink({
      ...apolloUploadConfig,
      uri: endpoint,
      fetch: runtimeFetch,
      useGETForQueries:
        useGETForQueries ?? apolloUploadConfig?.useGETForQueries,
      headers: uploadHeaders,
    })
    const cache = new InMemoryCache(memoryConfig)
    const initialCache = runtime.initialState?.[clientId]
    if (initialCache) cache.restore(initialCache)

    const clientConfig = apolloClientConfig
      ? { ...apolloClientConfig }
      : {}
    clients[clientId] = new ApolloClient({
      ...clientConfig,
      cache,
      link: from([errorLink, authLink, httpLink]),
      ssrMode: server,
      // Apollo temporarily honors restored SSR data even when a generated
      // composable requests a force-fetch policy during initial hydration.
      ssrForceFetchDelay:
        !server && initialCache ? clientConfig.ssrForceFetchDelay ?? 100 : 0,
    })
  }

  return clients
}
