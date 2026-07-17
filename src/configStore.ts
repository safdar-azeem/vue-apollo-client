import type { ApolloClient } from '@apollo/client/core/index.js'
import type { VueApolloClientOptions } from './types'

let globalConfig: VueApolloClientOptions | null = null
let globalClients: Record<string, ApolloClient<any>> | null = null

/** @deprecated Runtime-scoped configuration is available on `VueApolloRuntime.options`. */
export const setGlobalConfig = (config: VueApolloClientOptions) => {
  globalConfig = config
}

/** @deprecated Pass token/configuration explicitly or use the injected runtime. */
export const getGlobalConfig = (): VueApolloClientOptions => {
  return (
    globalConfig || {
      endPoints: { default: 'http://localhost:4000/graphql' },
      tokenKey: 'token',
    }
  )
}

/** @deprecated Install and inject a `VueApolloRuntime` instead. */
export const setClients = (clients: Record<string, ApolloClient<any>>) => {
  globalClients = clients
}

/** @deprecated Use `useApolloRuntime()` or an explicitly owned runtime. */
export const getClients = () => globalClients
