import createUploadLink from 'apollo-upload-client/createUploadLink.mjs'
import {
  ApolloClient,
  InMemoryCache,
  type ApolloClientOptions,
  type InMemoryCacheConfig,
  from,
  fromPromise,
} from '@apollo/client/core'
import { onError } from '@apollo/client/link/error'
import { setContext as setContextLink } from '@apollo/client/link/context'
import { getToken, stashToken, restoreStashedToken, removeToken } from '../composables/useCookies'

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
  memoryConfig?: InMemoryCacheConfig
  useGETForQueries?: boolean
  apolloClientConfig?: Partial<ApolloClientOptions<any>> | null
  apolloUploadConfig?: ApolloUploadConfig
  refreshToken?: () => Promise<string | void | null>
  onLogout?: () => void
}

let isRefreshing = false
let failedQueue: any[] = []

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })

  failedQueue = []
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
}: ConfigProps) => {
  // Automatically restore token if it was temporarily stashed due to network unreachable errors
  if (typeof window !== 'undefined') {
    restoreStashedToken(tokenKey)
  }

  const authLink = setContextLink((operation, prevContext) => {
    const token = getToken(tokenKey)
    const context = setContext?.({
      operationName: operation?.operationName || '',
      variables: operation?.variables,
      token: token || '',
    })

    return {
      ...context,
      headers: {
        authorization: token ? `${token}` : '',
        ...context?.headers,
        ...prevContext?.headers,
      },
    }
  })

  const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
    // Handle Network Errors (Server Unreachable / Connection Refused)
    if (networkError) {
      const isUnreachable =
        networkError.message.includes('Failed to fetch') ||
        networkError.message.includes('NetworkError') ||
        networkError.message.includes('ECONNREFUSED') ||
        ('statusCode' in networkError && (networkError as any).statusCode === 0) ||
        ('statusCode' in networkError && (networkError as any).statusCode >= 500)

      if (isUnreachable) {
        const currentToken = getToken(tokenKey)
        if (currentToken) {
          // Stash the token temporarily and clear main auth
          // so the auth guard redirects user to login until server recovers.
          stashToken(tokenKey)
          onLogout?.()
        }
      }
    }

    if (graphQLErrors) {
      for (const err of graphQLErrors) {
        // SYSTEM DESIGN FIX:
        // Only attempt to refresh if we actually have a token locally.
        // If we don't have a token, it means we are logging in (or public user),
        // so a 401 is just a standard error (wrong password, etc).
        const currentToken = getToken(tokenKey)

        if (
          (err.extensions?.code === 'UNAUTHENTICATED' || err.message === 'Unauthorized') &&
          refreshToken &&
          currentToken // <--- CRITICAL CHECK
        ) {
          if (isRefreshing) {
            return fromPromise(
              new Promise((resolve, reject) => {
                failedQueue.push({ resolve, reject })
              })
            )
              .filter((value) => Boolean(value))
              .flatMap((accessToken) => {
                const oldHeaders = operation.getContext().headers
                operation.setContext({
                  headers: {
                    ...oldHeaders,
                    authorization: `${accessToken}`,
                  },
                })
                return forward(operation)
              })
          }

          isRefreshing = true

          return fromPromise(
            refreshToken()
              .then((newToken) => {
                if (newToken) {
                  processQueue(null, newToken as string)
                  return newToken
                }
                // If refreshToken returns null or void, force a throw to trigger the catch block
                throw new Error('Refresh failed or returned null')
              })
              .catch((error) => {
                processQueue(error, null)
                // Explicitly remove tokens to clear all local auth state
                removeToken(tokenKey)
                // Trigger the user's logout callback to clear external state
                onLogout?.()
                // Return undefined so the original error bubbles up if refresh fails
                return
              })
              .finally(() => {
                isRefreshing = false
              })
          )
            .filter((value) => Boolean(value))
            .flatMap((accessToken) => {
              const oldHeaders = operation.getContext().headers
              operation.setContext({
                headers: {
                  ...oldHeaders,
                  authorization: `${accessToken}`,
                },
              })
              return forward(operation)
            })
        }
      }
    }
  })

  const clients: Record<string, ApolloClient<any>> = {}

  for (const [key, endpoint] of Object.entries(endPoints)) {
    const httpLink = createUploadLink({
      uri: endpoint,
      ...apolloUploadConfig,
      useGETForQueries: useGETForQueries || apolloUploadConfig?.useGETForQueries,
      headers: { 'Apollo-Require-Preflight': 'true', ...apolloUploadConfig?.headers },
    })

    const config = apolloClientConfig ? { ...apolloClientConfig } : {}

    clients[key] = new ApolloClient({
      ...(memoryConfig
        ? {
            cache: new InMemoryCache(memoryConfig),
            ...config,
          }
        : {
            cache: new InMemoryCache(),
            ...config,
          }),
      // @ts-ignore
      link: from([errorLink, authLink, httpLink]),
      ssrMode: typeof window === 'undefined',
    })
  }

  return clients
}

