import { useLazyQuery as apolloUseLazyQuery, UseQueryReturn } from '@vue/apollo-composable'
import { UseQueryOptions } from './useQuery'
import { ref, Ref, unref } from 'vue'
import { OperationVariables } from '@apollo/client/core'
import { unwrapVariables } from '../utils/common'

export interface UseLazyQueryReturn<
  TResult,
  TVariables extends OperationVariables,
> extends UseQueryReturn<TResult, TVariables> {
  load: (
    document?: any,
    variables?: TVariables,
    options?: UseQueryOptions<TResult, TVariables>
  ) => Promise<any>
}

export const useLazyQuery = <
  TResult = any,
  TVariables extends OperationVariables = OperationVariables,
>(
  document: any,
  variables?: TVariables | (() => TVariables) | Ref<TVariables>,
  options?:
    | UseQueryOptions<TResult, TVariables>
    | Ref<UseQueryOptions<TResult, TVariables>>
    | (() => UseQueryOptions<TResult, TVariables>)
): UseLazyQueryReturn<TResult, TVariables> => {
  const lazyQuery = apolloUseLazyQuery(document, variables, () => {
    const opt = typeof options === 'function' ? options() : unref(options)
    return {
      fetchPolicy: 'cache-and-network',
      ...(opt as any),
    }
  }) as any

  // Always keep loading as false after initial fetch
  const loadingState = ref(false)

  async function fetchOrRefetch(newVariables?: TVariables) {
    loadingState.value = lazyQuery.result?.value ? false : true

    try {
      if (!lazyQuery.result?.value) {
        // @ts-ignore
        await lazyQuery?.load(document, newVariables, options)
        return lazyQuery.refetch(unwrapVariables(newVariables || variables))
      } else {
        return lazyQuery.refetch(unwrapVariables(newVariables || variables))
      }
    } finally {
      loadingState.value = false
    }
  }

  return {
    ...lazyQuery,
    start: fetchOrRefetch,
    load: fetchOrRefetch,
    refetch: fetchOrRefetch,
    loading: loadingState,
  }
}
