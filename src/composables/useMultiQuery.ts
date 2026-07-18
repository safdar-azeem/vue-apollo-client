import { computed, type ComputedRef } from 'vue'

/**
 * Run several generated query composables together and expose their combined
 * result, loading and error state through one handle.
 *
 * Because it composes the individual query composables (which each own the
 * three-mode SSR contract from {@link useQuery}), `useMultiQuery` inherits that
 * contract for free: every listed query resolves on the server, serves from the
 * restored cache on hydration, and behaves normally in a SPA.
 *
 * The Nuxt module referenced queries by string key against an auto-imported
 * document map. A plain Vite/Vue app has no equivalent global map, so this
 * version takes the map of generated composables explicitly as the first
 * argument:
 *
 * ```ts
 * import * as queries from '@/graphql'
 * const { result, loading, error, refetch } = useMultiQuery(
 *   queries,
 *   ['useGetNavbarQuery', 'useGetFooterQuery'],
 *   { input: { websiteId } },
 * )
 * // result.value.useGetNavbarQuery, result.value.useGetFooterQuery
 * ```
 */

export interface UseMultiQueryHandle {
  /** Merged data keyed by composable name; single-field payloads are unwrapped. */
  result: ComputedRef<Record<string, unknown>>
  /** True while any listed query is loading. */
  loading: ComputedRef<boolean>
  /** Per-query error keyed by composable name, or `null`. */
  error: ComputedRef<Record<string, unknown>>
  /** Refetch every query, or only the named subset. */
  refetch: (
    variables?: Record<string, unknown>,
    refetchKeys?: string[]
  ) => Promise<void>
}

interface QueryEntry {
  key: string
  result: { value?: unknown } | null
  loading: { value?: boolean } | null
  error: { value?: unknown } | null
  refetch: ((variables?: Record<string, unknown>) => unknown) | null
}

type QueryComposable = (
  variables: Record<string, unknown>,
  options: Record<string, unknown>
) => {
  result: { value?: unknown }
  loading: { value?: boolean }
  error: { value?: unknown }
  refetch: (variables?: Record<string, unknown>) => unknown
}

export function useMultiQuery(
  queryDefinitions: Record<string, unknown>,
  queryKeys: string[],
  variables: Record<string, unknown> = {},
  options: Record<string, unknown> = {}
): UseMultiQueryHandle {
  const entries: QueryEntry[] = queryKeys.map((key) => {
    const composable = queryDefinitions[key]
    if (typeof composable !== 'function') {
      return { key, result: null, loading: null, error: null, refetch: null }
    }
    const { result, loading, error, refetch } = (composable as QueryComposable)(
      variables,
      options
    )
    return { key, result, loading, error, refetch }
  })

  const result = computed<Record<string, unknown>>(() =>
    entries.reduce<Record<string, unknown>>((accumulator, { key, result: entry }) => {
      const rawValue = entry?.value
      if (rawValue && typeof rawValue === 'object') {
        const fields = Object.keys(rawValue as Record<string, unknown>)
        // Unwrap single-field GraphQL payloads (`{ getNavbar: … }` → the value).
        accumulator[key] =
          fields.length === 1
            ? (rawValue as Record<string, unknown>)[fields[0]!]
            : rawValue
      } else {
        accumulator[key] = rawValue
      }
      return accumulator
    }, {})
  )

  const loading = computed(() =>
    entries.some((entry) => Boolean(entry.loading?.value))
  )

  const error = computed<Record<string, unknown>>(() =>
    entries.reduce<Record<string, unknown>>((accumulator, entry) => {
      accumulator[entry.key] = entry.error?.value ?? null
      return accumulator
    }, {})
  )

  const refetch = async (
    nextVariables: Record<string, unknown> = {},
    refetchKeys?: string[]
  ) => {
    const targetKeys =
      refetchKeys && refetchKeys.length > 0
        ? refetchKeys
        : entries.map((entry) => entry.key)
    await Promise.all(
      entries
        .filter(
          (entry) =>
            targetKeys.includes(entry.key) && typeof entry.refetch === 'function'
        )
        .map((entry) => entry.refetch!(nextVariables))
    )
  }

  return { result, loading, error, refetch }
}
