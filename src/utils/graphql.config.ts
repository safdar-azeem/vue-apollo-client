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
import type {
  VueApolloRefreshContract,
  VueApolloRuntimeOptions,
} from '../types'
import { resolveApolloSessionCacheKey } from '../ApolloSessionRuntime'

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
  refresh?: VueApolloRefreshContract<any, any>
  refreshToken?: () => Promise<string | void | null>
  onLogout?: () => void
  getToken?: () => string | null | undefined
  clearToken?: () => void
  formatToken?: (token: string) => string
  getSessionId?: () => string | null | undefined
  runtime?: VueApolloRuntimeOptions
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
  refresh,
  refreshToken,
  onLogout,
  getToken,
  clearToken,
  formatToken = (token) => token,
  getSessionId,
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

  const clients: Record<string, ApolloClient<NormalizedCacheObject>> = {}
  const refreshPromises = new Map<string, Promise<string>>()
  let lastSessionKey = server
    ? null
    : resolveApolloSessionCacheKey(getSessionId?.() ?? null)
  const clearAllStores = async () => {
    await Promise.all(Object.values(clients).map(async (client) => {
      try {
        await client.clearStore()
      } catch {
        // Best-effort browser session cleanup.
      }
    }))
  }

  const authLink = setContextLink(async (operation, previousContext) => {
    if (!server && getSessionId) {
      // Compare stable session keys — never raw rotating access/refresh tokens.
      const nextSessionKey = resolveApolloSessionCacheKey(getSessionId() ?? null)
      if (nextSessionKey !== lastSessionKey) {
        lastSessionKey = nextSessionKey
        await clearAllStores()
      }
    }
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

  const runRefresh = (failedClientId: string): Promise<string> => {
    const refreshClientId = refresh?.clientId || failedClientId
    const existing = refreshPromises.get(refreshClientId)
    if (existing) return existing

    const promise = (async () => {
      if (refresh) {
        const refreshTokenValue = refresh.getRefreshToken()
        if (!refreshTokenValue) throw new Error('No refresh token is available.')
        let data: unknown
        if (refresh.useMutation) {
          const createMutation = () => refresh.useMutation!({
            clientId: refreshClientId,
            context: { vueApolloSkipRefresh: true },
            errorPolicy: 'none',
          })
          const mutation = runtime.runWithContext
            ? runtime.runWithContext(createMutation)
            : createMutation()
          const result = await mutation.mutate(
            refresh.createVariables(refreshTokenValue),
            { context: { vueApolloSkipRefresh: true }, errorPolicy: 'none' }
          )
          data = result?.data
        } else if (refresh.document) {
          const refreshClient = clients[refreshClientId]
          if (!refreshClient) {
            throw new Error(`Apollo refresh client "${refreshClientId}" is not installed.`)
          }
          const result = await refreshClient.mutate({
            mutation: refresh.document,
            variables: refresh.createVariables(refreshTokenValue),
            errorPolicy: 'none',
            context: { vueApolloSkipRefresh: true },
          })
          data = result.data
        } else {
          throw new Error('Apollo refresh requires a generated mutation composable.')
        }
        const tokens = refresh.selectTokens(data)
        if (!tokens?.token) throw new Error('Token refresh returned no access token.')
        await refresh.persistTokens(tokens)
        return tokens.token
      }

      const token = await refreshToken?.()
      if (!token) throw new Error('Token refresh returned no access token.')
      return token
    })().finally(() => refreshPromises.delete(refreshClientId))

    refreshPromises.set(refreshClientId, promise)
    return promise
  }

  const createErrorLink = (clientId: string) => onError(
    ({ graphQLErrors, networkError, operation, forward }) => {
      if (server) return

      const statusCode =
        (networkError as any)?.statusCode ??
        (networkError as any)?.result?.status
      const networkAuthenticationFailure =
        statusCode === 401 || statusCode === 403

      if (networkError) {
        if (networkAuthenticationFailure && !refresh && !refreshToken) {
          if (readToken() || refresh?.getRefreshToken()) {
            removeConfiguredToken()
            void clearAllStores()
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
      ) || networkAuthenticationFailure
      const canRefresh = refresh
        ? Boolean(refresh.getRefreshToken())
        : Boolean(refreshToken && readToken())
      if (authenticationFailure && !canRefresh) {
        removeConfiguredToken()
        void refresh?.clearTokens?.()
        void clearAllStores()
        onLogout?.()
        return
      }
      if (
        !authenticationFailure ||
        operation.getContext()?.vueApolloSkipRefresh
      ) return

      return fromPromise(
        runRefresh(clientId)
          .catch((error) => {
            removeConfiguredToken()
            void refresh?.clearTokens?.()
            void clearAllStores()
            onLogout?.()
            throw error
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
      link: from([createErrorLink(clientId), authLink, httpLink]),
      ssrMode: server,
      // Apollo temporarily honors restored SSR data even when a generated
      // composable requests a force-fetch policy during initial hydration.
      ssrForceFetchDelay:
        !server && initialCache ? clientConfig.ssrForceFetchDelay ?? 100 : 0,
    })
  }

  return clients
}
