import { getClients } from '../configStore'
import { provideApolloClients } from '@vue/apollo-composable'

export function loadApolloClients() {
  if (typeof window === 'undefined') {
    throw new Error(
      'loadApolloClients() is browser-only. SSR code must use app-provided request-scoped clients.'
    )
  }
  const clients = getClients()
  if (clients) {
    provideApolloClients(clients)
  }
}
