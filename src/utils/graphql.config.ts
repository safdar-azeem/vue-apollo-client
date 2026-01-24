import createUploadLink from 'apollo-upload-client/createUploadLink.mjs'
import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  concat,
  type ApolloClientOptions,
  type InMemoryCacheConfig,
} from '@apollo/client/core'
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
}

export const graphqlConfig = ({
  endPoints,
  tokenKey,
  setContext,
  memoryConfig,
  useGETForQueries,
  apolloClientConfig,
  apolloUploadConfig,
}: ConfigProps) => {
  const authLink = new ApolloLink((operation, forward) => {
    const token = getToken(tokenKey)
    const context = setContext?.({
      operationName: operation?.operationName,
      variables: operation?.variables,
      token: token || '',
    })

    operation.setContext({
      ...context,
      headers: {
        authorization: token ? `${token}` : '',
        ...context?.headers,
      },
    })

    return forward(operation)
  })

  const clients: Record<string, ApolloClient<any>> = {}

  for (const [key, endpoint] of Object.entries(endPoints)) {
    const link = createUploadLink({
      uri: endpoint,
      ...apolloUploadConfig,
      useGETForQueries: useGETForQueries || apolloUploadConfig?.useGETForQueries,
      headers: { 'Apollo-Require-Preflight': 'true', ...apolloUploadConfig?.headers },
    })

    const config = apolloClientConfig ? { ...apolloClientConfig } : {}

    clients[key] = new ApolloClient({
      ...(memoryConfig
        ? {
            ...config,
            cache: new InMemoryCache(memoryConfig),
          }
        : {
            cache: new InMemoryCache(),
            ...config,
          }),
      // @ts-ignore
      link: concat(authLink, link),
      ssrMode: typeof window === 'undefined', // Simple SSR detection
    })
  }

  return clients
}
