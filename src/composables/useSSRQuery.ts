
import { ref } from 'vue'
import { inject } from 'vue'
import { ApolloClients } from '@vue/apollo-composable'
import { ApolloClient } from '@apollo/client/core'

const defaultResult = () => {
   const result = ref(null)
   const loading = ref(false)
   const error = ref(null)

   return {
      result,
      loading,
      error,
      onResult: (callback: any) => {
         callback?.(result.value)
      },
      onError: (callback: any) => {
         callback?.(error.value)
      },
      start: () => {},
      stop: () => {},
      restart: () => {},
      refetch: () => {},
      onCompleted: () => {},
   }
}

export const useSSRQuery = async (document: any, variables: any, options: any) => {
   const clients = inject(ApolloClients) as Record<string, ApolloClient<any>>
   const clientId = options?.clientId || 'default'
   const apolloClient = clients?.[clientId]

   if (!apolloClient) {
       console.error(`Apollo client ${clientId} not found.`)
       return defaultResult()
   }

   try {
      const queryResult = await apolloClient.query({
         query: document,
         variables,
         ...options,
      })

      const result = ref(queryResult?.data)
      const loading = ref(false)
      const error = ref(queryResult?.error)
      let onResultCallBack = (vars:any) => {}

      const onResult = (callback: any) => {
         if (queryResult?.data) {
            onResultCallBack = callback
            callback?.(result)
         }
      }

      const onError = (callback: any) => {
         if (queryResult?.error) {
            callback?.(queryResult.error)
         }
      }

      const refetch = async (newVariables: any) => {
         error.value = null as any
         
         try {
            const refetchResult = await apolloClient.query({
               query: document,
               variables: newVariables || variables,
               fetchPolicy: 'network-only', 
               ...options,
            })
            
            onResultCallBack(refetchResult?.data)

            result.value = refetchResult?.data
            return refetchResult
         } catch (refetchError) {
            error.value = refetchError as any
            throw refetchError
         } 
      }

      return { ...defaultResult(), result, loading, error, onResult, onError, refetch }
   } catch (error) {
      const errorRef = ref(error)

      const onError = (callback: any) => {
         callback?.(error)
      }

      return { ...defaultResult(), error: errorRef, onError }
   }
}
