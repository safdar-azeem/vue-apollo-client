import type { App } from 'vue'
import { ApolloClients } from '@vue/apollo-composable'
import type { ApolloClient, NormalizedCacheObject } from '@apollo/client/core/index.js'
import type {
  VueApolloClientOptions,
  VueApolloRuntimeOptions,
  VueApolloState,
} from './types'
import { setGlobalConfig, setClients } from './configStore'
import { graphqlConfig } from './utils/graphql.config'

export type VueApolloClients = Record<string, ApolloClient<NormalizedCacheObject>>

export const extractApolloState = (clients: VueApolloClients): VueApolloState =>
  Object.fromEntries(
    Object.entries(clients).map(([clientId, client]) => [clientId, client.extract()])
  )

export const restoreApolloState = (
  clients: VueApolloClients,
  state: VueApolloState | null | undefined
): void => {
  if (!state) return
  for (const [clientId, cacheState] of Object.entries(state)) {
    clients[clientId]?.cache.restore(cacheState)
  }
}

export const createApollo = (
  options: VueApolloClientOptions,
  runtime: VueApolloRuntimeOptions = {}
) => {
  const server = runtime.server ?? typeof window === 'undefined'
  const registerGlobal = runtime.registerGlobal ?? !server

  const clients = graphqlConfig({
    endPoints: options.endPoints,
    tokenKey: options.tokenKey || 'token',
    setContext: options.setContext,
    memoryConfig: options.memoryConfig,
    useGETForQueries: options.useGETForQueries,
    apolloClientConfig: options.apolloClientConfig,
    apolloUploadConfig: options.apolloUploadConfig,
    refreshToken: options.refreshToken,
    onLogout: options.onLogout,
    getToken: options.getToken,
    clearToken: options.clearToken,
    formatToken: options.formatToken,
    runtime: { ...runtime, server },
  })

  if (registerGlobal) {
    setGlobalConfig(options)
    setClients(clients)
  }

  return {
    install(app: App) {
      app.provide(ApolloClients, clients)
    },
    clients,
    extract: () => extractApolloState(clients),
    restore: (state: VueApolloState | null | undefined) =>
      restoreApolloState(clients, state),
    stop: () => {
      for (const client of Object.values(clients)) client.stop()
    },
  }
}
