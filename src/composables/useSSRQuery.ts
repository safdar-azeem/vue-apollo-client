import { type Ref } from 'vue'
import type { OperationVariables } from '@apollo/client/core/index.js'
import { useQuery, type UseQueryOptions, type UseQueryReturn } from './useQuery'

/**
 * Backward-compatible alias for the unified query composable.
 *
 * Vue Apollo's native `onServerPrefetch` integration performs SSR prefetching;
 * callers receive the same synchronous return object on server and browser.
 * Existing `await useSSRQuery(...)` calls remain valid because awaiting a
 * non-Promise returns that object unchanged.
 *
 * @deprecated Use the generated query composable or `useQuery`. This alias
 * will be removed in the next major release.
 */
export const useSSRQuery = <
  TResult = any,
  TVariables extends OperationVariables = OperationVariables,
>(
  document: any,
  variables?: TVariables | (() => TVariables) | Ref<TVariables>,
  options?:
    | UseQueryOptions<TResult, TVariables>
    | Ref<UseQueryOptions<TResult, TVariables>>
    | (() => UseQueryOptions<TResult, TVariables>)
): UseQueryReturn<TResult, TVariables> => {
  return useQuery<TResult, TVariables>(document, variables, options)
}
