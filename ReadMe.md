# vue-apollo-client

Package-managed Apollo for Vue 3 SPA, SSR, and hydration. Applications declare
one configuration and use generated composables; the package owns client
creation, request isolation, prefetch, cache transfer, restoration, cleanup,
timeouts, token refresh, and Vite runtime identity.

## Setup

Keep operations in `src/graphql/**/*.graphql` and enable code generation:

```ts
// vite.config.ts
import { vueApollo } from 'vue-apollo-client/vite'

export default {
  plugins: [
    vueApollo({
      schema: process.env.VITE_GRAPHQL_ENDPOINT,
      documents: ['src/graphql/**/*.{graphql,gql}'],
    }),
  ],
}
```

Define one configuration. `defineApollo` returns a Vue plugin, not an Apollo
client. It creates the internal runtime only when an owning Vue application is
installed.

```ts
// src/config/ApolloConfiguration.ts
import {
  defineApollo,
  getRefreshToken,
  setToken,
} from 'vue-apollo-client'
import { useRefreshTokensMutation } from '@/graphql'

export default defineApollo(({ applicationId }) => ({
  endPoints: { default: import.meta.env.VITE_GRAPHQL_ENDPOINT },
  authBoundary:
    applicationId === 'storefront' ? 'storefront-customer' : 'admin',
  requestTimeoutMs: 8_000,
  refresh: {
    useMutation: useRefreshTokensMutation,
    getRefreshToken: () => getRefreshToken('auth_token'),
    createVariables: (refreshToken) => ({ refreshToken }),
    selectTokens: (data) => data?.refreshTokens,
    persistTokens: ({ token, refreshToken }) =>
      setToken({ key: 'auth_token', token, refreshToken }),
  },
}), { applicationId: 'admin' })
```

Install that same plugin in a SPA:

```ts
const app = createApp(App)
app.use(apolloConfiguration)
app.mount('#app')
```

An SSR host can install it as a generic application plugin. When the host
provides the `vue-ssr` request and hydration contracts, the package
automatically:

- creates a fresh named-client set and cache for each request;
- forwards only the host-filtered cookie header;
- attaches the request abort signal and configured timeout;
- waits for generated composables using Vue server prefetch;
- extracts cache state after rendering;
- restores it before browser component setup;
- prevents duplicate initial hydration queries; and
- stops request clients during host cleanup.

No application code creates a server client, calls `executeQuery`, extracts a
cache, serializes state, or restores hydration data.

## GraphQL usage

```graphql
# src/graphql/queries/store.graphql
query GetEcommerceStore($domain: String!) {
  getEcommerceStore(domain: $domain) { id storeName }
}
```

```ts
import { useGetEcommerceStoreQuery } from '@/graphql'

const storeQuery = useGetEcommerceStoreQuery(
  { domain },
  { ssr: true, fetchPolicy: 'cache-first' },
)
```

Mutations use the generated composables in the same way:

```ts
const { mutate } = useCreateEcommerceOrderMutation()
await mutate({ data })
```

Disabled generated queries can be used on demand without accessing a client:

```ts
const query = useGetServiceQuery({ id }, { enabled: false })
const result = await query.refetch({ id })
query.stop()
```

## Generated-composable auth

```ts
import { createAuthRuntime } from 'vue-apollo-client'
import { useMeQuery } from '@/graphql'

const auth = createAuthRuntime({
  useMeQuery,
  tokenKey: 'auth_token',
  loginRoute: '/auth/login',
  meSelector: (data) => data?.me,
})
```

`verify()` is single-flight. Authentication teardown clears tokens and the
active application cache before navigation. A configured `getSessionId`
automatically invalidates cached data when the browser session changes.

## Advanced compatibility API

`createApollo` remains available for package integrations and legacy advanced
hosts. Normal applications should use `defineApollo`; request runtimes and
cache lifecycle should not be application-owned.
