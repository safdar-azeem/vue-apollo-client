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
import { getToken } from '../composables/useCookies'

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

  const errorLink = onError(({ graphQLErrors, operation, forward }) => {
    if (graphQLErrors) {
      for (const err of graphQLErrors) {
        if (
          (err.extensions?.code === 'UNAUTHENTICATED' || err.message === 'Unauthorized') &&
          refreshToken
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
                throw new Error('Refresh failed')
              })
              .catch((error) => {
                processQueue(error, null)
                onLogout?.()
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
