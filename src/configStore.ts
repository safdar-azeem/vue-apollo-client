import { ApolloClient } from '@apollo/client/core'
import { VueApolloClientOptions } from './types'

let globalConfig: VueApolloClientOptions | null = null
let globalClients: Record<string, ApolloClient<any>> | null = null

export const setGlobalConfig = (config: VueApolloClientOptions) => {
  globalConfig = config
}

export const getGlobalConfig = (): VueApolloClientOptions => {
  return (
    globalConfig || {
      endPoints: { default: 'http://localhost:4000/graphql' },
      tokenKey: 'token',
    }
  )
}

export const setClients = (clients: Record<string, ApolloClient<any>>) => {
  globalClients = clients
}

export const getClients = () => globalClients
