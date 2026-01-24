import { UseQueryOptions } from '@vue/apollo-composable' // Import base type
import { computed } from 'vue'

// Since we cannot easily dynamically import documents by string key (webpack/vite context thing),
// the MultiQuery in standard Vue should probably take *functions* or *composables* or *explicit functions*.
// However, the Nuxt module relies on `allGraphqlDocuments[key]`.
// In Vue, we don't have `#graphql`.
// So I will adapt useMultiQuery to accept a list of useQuery-like functions or maybe just keys if the user provides a map?
// The Nuxt version is very specific to the codegen output structure.
// "queries: string[]" implies keys in `allGraphqlDocuments`.
// Since I can't replicate the auto-import of all documents easily without a Vite plugin,
// I'll make useMultiQuery accept a map of query functions as the second argument, OR try to stick to the signature.

// If I want to keep compatibility:
// I'll assume the user might need to pass the "lookup" object.
// Or, if I export `useMultiQuery` that takes `(queries: ReturnType<typeof useQuery>[])`, it's different.

// Let's implement a version that mimics the behavior but maybe explicitly asks for the query objects?
// The Nuxt one takes STRINGS.
// "useMultiQuery(['useGetUsersLazyQuery', 'useMeQuery'])"
// It imports `* as allGraphqlDocuments`.

// In this library, I can't know `allGraphqlDocuments`.
// So I will export `createMultiQuery` which takes the documents object, and returns `useMultiQuery`.
// OR I'll standardly export `useMultiQuery` but it expects the first arg to be an object OR it changes signature.
// User requirement: "convert... with all similar feature".
// If I change signature, I break it.
// I will export `useMultiQuery` but the user must provide the map context somewhere or I just can't do it via strings.
// Wait, the user can do: `import * as queries from './generated'; useMultiQuery(queries, ['q1', 'q2'])`
// That seems reasonable.

// Let's implement `useMultiQuery` that accepts the query map as an extra arg, OR
// generic version: `useMultiQuery(definitions: Record<string, any>, keys: string[])`.

// Nuxt: `useMultiQuery(queries: string[], ...)`
// My adaptation: `useMultiQuery(queryMap: Record<string, Function>, keys: string[], ...)`
// This is slight change but necessary.

export function useMultiQuery(
  queryDefinitions: Record<string, any>, // Added argument
  queryKeys: string[],
  variables: Record<string, any> = {},
  options: any = {}
) {
  const results = queryKeys.map((key) => {
    const query = queryDefinitions[key]
    if (!query || typeof query !== 'function') {
      return { key, result: null, loading: null, error: null, refetch: null }
    }

    const { result, loading, error, refetch } = query(variables, options)
    return { key, result, loading, error, refetch }
  })

  // @ts-ignore
  const data = computed(() => {
    return results.reduce(
      (acc, { key, result }) => {
        // @ts-ignore
        const rawValue = result?.value
        if (rawValue && typeof rawValue === 'object') {
          const keys = Object.keys(rawValue)
          if (keys.length === 1) {
            acc[key] = rawValue[keys[0]]
          } else {
            acc[key] = rawValue
          }
        } else {
          acc[key] = rawValue
        }
        return acc
      },
      {} as Record<string, any>
    )
  })

  const loading = computed(() => results.some((r) => r.loading?.value))

  const error = computed(() => {
    return results.reduce(
      (acc, { key, error }) => {
        acc[key] = error?.value ?? null
        return acc
      },
      {} as Record<string, any>
    )
  })

  const refetch = async (variables: Record<string, any> = {}, refetchKeys?: string[]) => {
    const keysToRefetch =
      refetchKeys && refetchKeys.length > 0 ? refetchKeys : results.map((r) => r.key)

    await Promise.all(
      results
        .filter((r) => keysToRefetch.includes(r.key) && typeof r.refetch === 'function')
        .map((r) => r.refetch!(variables))
    )
  }

  return {
    result: data,
    loading,
    error,
    refetch,
  }
}
