
import { useLazyQuery as apolloUseLazyQuery, UseQueryReturn, UseQueryOptions } from '@vue/apollo-composable'
import { ref, Ref } from 'vue'
import { OperationVariables } from '@apollo/client/core'

export interface UseLazyQueryReturn<TResult, TVariables> extends UseQueryReturn<TResult, TVariables> {
  load: (document?: any, variables?: TVariables, options?: UseQueryOptions<TResult, TVariables>) => Promise<any>
}

export const useLazyQuery = <TResult = any, TVariables extends OperationVariables = OperationVariables>(
  document: any,
  variables?: TVariables | (() => TVariables),
  options?: UseQueryOptions<TResult, TVariables>
): UseLazyQueryReturn<TResult, TVariables> => {
  const lazyQuery = apolloUseLazyQuery(document, variables, {
    fetchPolicy: 'cache-and-network',
    ...options,
  }) as any

  // Always keep loading as false after initial fetch
  const loadingState = ref(false)
   
  async function fetchOrRefetch(newVariables?: TVariables) {
      loadingState.value = lazyQuery.result?.value ? false : true
     
    try {      
      if (!lazyQuery.result?.value) {
        // @ts-ignore
        await lazyQuery?.load(document, newVariables, options)
        return lazyQuery.refetch(newVariables || variables)
      } else { 
        return lazyQuery.refetch(newVariables || variables)
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
