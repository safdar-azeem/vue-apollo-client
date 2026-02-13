import { App } from 'vue'
import { provideApolloClients, ApolloClients } from '@vue/apollo-composable'
import { VueApolloClientOptions } from './types'
import { setGlobalConfig, setClients } from './configStore'
import { graphqlConfig } from './utils/graphql.config'

export const createApollo = (options: VueApolloClientOptions) => {
  setGlobalConfig(options)

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
  })

  setClients(clients)

  return {
    install(app: App) {
      provideApolloClients(clients)
      app.provide(ApolloClients, clients)
      // Provide individual clients if needed or just the map
      // @vue/apollo-composable provideApolloClients does the heavy lifting for useQuery

      // We can also expose clients globally if needed, but provide is best.
    },
    clients,
  }
}
