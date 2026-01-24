import { getClients } from '../configStore'
import { provideApolloClients } from '@vue/apollo-composable'

export function loadApolloClients() {
  const clients = getClients()
  if (clients) {
    provideApolloClients(clients)
  }
}
