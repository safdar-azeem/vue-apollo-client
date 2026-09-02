import { defineApollo } from 'vue-apollo-client'
import { useMeQuery, useRefreshSessionMutation } from '../graphql/generated'

export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT || 'http://localhost:4000/graphql',
  tokenKey: 'demo_auth',
  formatToken: token => `Bearer ${token}`,

  auth: {
    useMeQuery,
    meSelector: data => data?.me,
    permissions: user => user?.permissions || [],
  },

  refresh: {
    useMutation: useRefreshSessionMutation,
    createVariables: refreshToken => ({ refreshToken }),
    selectTokens: data => data?.refreshSession,
  },
})
