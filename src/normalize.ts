import type { VueApolloClientOptions } from './types'

export type NormalizedVueApolloClientOptions = VueApolloClientOptions & {
  endPoints: Record<string, string>
  tokenKey: string
}

const DEFAULT_ENDPOINT = 'http://localhost:4000/graphql'

const normalizeEndpoint = (value: string, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Apollo configuration requires a non-empty ${label}.`)
  }
  return value.trim()
}

/**
 * Keep the public single-endpoint API and the named-client runtime on one path.
 * `endpoint` and `endPoints` are intentionally not merged: accepting both
 * would make the default client ambiguous.
 */
export const normalizeApolloOptions = (
  options: VueApolloClientOptions,
): NormalizedVueApolloClientOptions => {
  const hasEndpoint = options.endpoint !== undefined
  const hasNamedEndpoints = options.endPoints !== undefined

  if (hasEndpoint && hasNamedEndpoints) {
    throw new Error('Configure either `endpoint` or `endPoints`, not both.')
  }

  const configuredEndPoints = hasEndpoint
    ? { default: normalizeEndpoint(options.endpoint as string, '`endpoint` value') }
    : options.endPoints ?? { default: DEFAULT_ENDPOINT }

  if (Object.keys(configuredEndPoints).length === 0) {
    throw new Error('Apollo configuration must include at least one endpoint.')
  }

  const endPoints = Object.fromEntries(
    Object.entries(configuredEndPoints).map(([clientId, endpoint]) => [
      clientId,
      normalizeEndpoint(endpoint, `endpoint for client "${clientId}"`),
    ])
  )

  const normalized = {
    ...options,
    endPoints,
    tokenKey: options.tokenKey || 'token',
  }
  delete normalized.endpoint
  return normalized
}
