
import type { InMemoryCacheConfig, ApolloClientOptions } from '@apollo/client/core'
import type { ApolloUploadConfig } from './utils/graphql.config'

export interface VueApolloClientOptions {
  endPoints: Record<string, string>
  tokenKey?: string
  tokenExpiration?: number | Date
  memoryConfig?: Partial<InMemoryCacheConfig>
  useGETForQueries?: boolean
  apolloClientConfig?: Partial<ApolloClientOptions<any>>
  apolloUploadConfig?: Partial<ApolloUploadConfig>
  refetchOnUpdate?: boolean
  refetchTimeout?: number
  allowOffline?: boolean
  setContext?: (context: { operationName?: string; variables?: any; token?: string }) => Record<string, any>
}

// Global config injection key
export const APOLLO_CLIENT_CONFIG = Symbol('APOLLO_CLIENT_CONFIG')
