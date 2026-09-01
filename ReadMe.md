# Vue Apollo Client

A simple Vue 3 Apollo Client integration with GraphQL code generation, typed composables, caching, authentication, SSR, uploads, multiple clients, and offline mutation support.

## Features

- Vue 3 + Apollo Client integration
- GraphQL Code Generator
- Typed queries and mutations
- `useQuery`, `useLazyQuery`, `useMutation`, `useMultiQuery`
- Access token and refresh token authentication
- Automatic cookie-based token management
- Multiple GraphQL clients
- Custom headers and request context
- File uploads
- Offline mutations
- SSR and hydration
- Apollo cache configuration
- `defineApollo` for normal apps and managed SSR
- `createApollo` for advanced integrations

## Installation

```bash
npm install vue-apollo-client
# or
yarn add vue-apollo-client
```

`vue-apollo-client/vite` is included in the package. No separate Vite plugin package is required.

> Vue 3.3+ is supported. The Vite integration assumes an existing Vite-based Vue project.

## Minimal Configuration

### 1. Add the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig({
  plugins: [vue(), vueApollo()],
})
```

Optional configuration:

```ts
vueApollo({
  documents: ['src/graphql/**/*.graphql'],
  schema: 'https://api.example.com/graphql',
  output: 'src/graphql/generated.ts',
})
```

By default, the plugin:

- Reads `src/**/*.{graphql,gql}`
- Generates `src/graphql/generated.ts`
- Watches GraphQL files during development

### 2. Add the GraphQL endpoint

```bash
# .env
VITE_GRAPHQL_ENDPOINT=https://api.example.com/graphql
```

If `schema` is not provided, the Vite plugin uses:

1. `VITE_GRAPHQL_ENDPOINT`
2. `VITE_API_URL/graphql`
3. `http://localhost:4000/graphql`

### 3. Create Apollo configuration

```ts
// src/config/apollo.ts
import { defineApollo } from 'vue-apollo-client'

export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
})
```

### 4. Install Apollo

```ts
// src/main.ts
import { createApp } from 'vue'
import App from './App.vue'
import apollo from './config/apollo'

const app = createApp(App)
app.use(apollo)
app.mount('#app')
```

### 5. Add GraphQL operations

```graphql
# src/graphql/users.graphql

query GetUsers {
  users {
    id
    name
  }
}

query GetUser($id: ID!) {
  user(id: $id) {
    id
    name
  }
}

mutation CreateUser($name: String!) {
  createUser(name: $name) {
    id
    name
  }
}
```

Every operation must have a unique name.

### 6. Generate composables

```bash
npm run dev
```

The plugin generates typed composables in `src/graphql/generated.ts`. Commit this file because production client and SSR builds do not run live code generation.

# Usage

## 1. Query

```vue
<script setup lang="ts">
import { useGetUsersQuery } from './graphql/generated'

const { result, loading, error, refetch } = useGetUsersQuery()
</script>

<template>
  <p v-if="loading">Loading...</p>
  <p v-else-if="error">Could not load users.</p>

  <ul v-else>
    <li v-for="user in result?.users ?? []" :key="user.id">
      {{ user.name }}
    </li>
  </ul>

  <button type="button" @click="refetch">Reload</button>
</template>
```

### Query with variables

```ts
const { result } = useGetUserQuery({ id: 'user-1' })
```

### Reactive query

```ts
import { ref } from 'vue'

const userId = ref('user-1')
const { result } = useGetUserQuery({ id: userId })
```

Or:

```ts
const { result } = useGetUserQuery(() => ({ id: userId.value }))
```

### Enable or disable a query

```ts
const { result } = useGetUserQuery(
  () => ({ id: userId.value }),
  () => ({ enabled: Boolean(userId.value) })
)
```

Common options such as `fetchPolicy`, `errorPolicy`, `context`, and `clientId` can be passed as query options.

## 2. Lazy Query

Use `useLazyQuery` when a query should run only after an explicit action.

```ts
import { gql } from 'graphql-tag'
import { useLazyQuery } from 'vue-apollo-client'

const GET_USER = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
    }
  }
`

const { result, loading, error, load, start, refetch } = useLazyQuery(GET_USER, () => ({
  id: userId.value,
}))

await load()
```

`start()` is an alias for the same deferred execution behavior.

> Lazy queries do not auto-run during SSR. If `load()` or `start()` is explicitly called while rendering on the server, the query executes as part of that SSR request.

## 3. Mutation

```ts
import { useCreateUserMutation } from './graphql/generated'

const { mutate, loading, error } = useCreateUserMutation()

await mutate({ name: 'Ada Lovelace' })
```

Refetch queries after a mutation:

```ts
await mutate({ name: 'Ada Lovelace' }, { refetchQueries: ['GetUsers'] })
```

> Mutations are skipped during server rendering. Trigger writes from browser-side actions.

## 4. Multiple Queries

Use `useMultiQuery` to combine several generated query composables under one result, loading, error, and refetch handle.

```ts
import * as queries from './graphql/generated'
import { useMultiQuery } from 'vue-apollo-client'

const { result, loading, error, refetch } = useMultiQuery(
  queries,
  ['useGetNavbarQuery', 'useGetFooterQuery'],
  { websiteId: websiteId.value },
  { clientId: 'default' }
)
```

```ts
result.value.useGetNavbarQuery
result.value.useGetFooterQuery

await refetch({}, ['useGetNavbarQuery']) // one
await refetch() // all
```

## 5. Multiple GraphQL Clients

```ts
// src/config/apollo.ts
export default defineApollo({
  endPoints: {
    default: 'https://api.example.com/graphql',
    admin: 'https://admin.example.com/graphql',
  },
})
```

Default client:

```ts
const { result } = useGetUsersQuery()
```

Named client:

```ts
const { result } = useGetUsersQuery({}, { clientId: 'admin' })
```

Do not use `endpoint` and `endPoints` together.

## 6. Offline Mutations

Enable offline support:

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  allowOffline: true,
})
```

Use generated mutations normally:

```ts
const { mutate } = useUpdateDraftMutation()

await mutate({
  id: draftId,
  title: title.value,
})
```

When the browser is offline, supported mutations are queued in `localStorage` and replayed when connectivity returns.

Important:

- Variables must be JSON-serializable.
- File uploads cannot be queued offline.
- Use offline mode only for mutations that are safe to replay.

# Authentication

## 7. Set Token

```ts
import { setToken } from 'vue-apollo-client'

setToken('access-token')
```

Custom key:

```ts
setToken({
  key: 'auth_token',
  token: 'access-token',
})
```

## 8. Authorization Header

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  tokenKey: 'auth_token',
  formatToken: (token) => `Bearer ${token}`,
})
```

Without `formatToken`, the token is sent unchanged as the `authorization` header value.

## 9. Get Token

```ts
import { getToken } from 'vue-apollo-client'

const token = getToken('auth_token')
```

## 10. Remove Token

```ts
import { removeToken } from 'vue-apollo-client'

removeToken('auth_token')
```

This also removes the related refresh-token cookie.

## 11. `useAuth`

```ts
import { useAuth } from 'vue-apollo-client'
import { useMeQuery } from './graphql/generated'

const { user, isAuthenticated, loading, error, verify, verifySession, logout, reset } = useAuth({
  useMeQuery,
  loginRoute: '/login',
  navigate: (path) => router.push(path),
})
```

| API               | Purpose                      |
| ----------------- | ---------------------------- |
| `user`            | Current authenticated user   |
| `isAuthenticated` | Authentication state         |
| `loading`         | Session verification state   |
| `error`           | Verification error           |
| `verifySession()` | Verify without navigation    |
| `verify()`        | Verify with legacy redirect  |
| `logout()`        | Clear token and Apollo cache |
| `reset()`         | Reset local auth state       |

By default, `useAuth` expects the authenticated user at `data.me`.

`verifySession()` updates authentication state and tears down an invalid session
without navigating, which is the primitive used by route middleware. `verify()`
retains the legacy behavior of redirecting an expired session to `loginRoute`
with the configured `sessionExpiredReason`. `logout()` still navigates to
`loginRoute` after it clears the session; pass a callback to `logout()` when the
calling application owns SPA router navigation.

For another response shape:

```ts
useAuth({
  useMeQuery,
  meSelector: (data) => data?.currentUser,
})
```

## 12. Refresh Token

Save access and refresh tokens:

```ts
setToken({
  key: 'auth_token',
  token: 'access-token',
  refreshToken: 'refresh-token',
})
```

Configure refresh:

```ts
import { useRefreshTokensMutation } from './graphql/generated'

export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  tokenKey: 'auth_token',
  refresh: {
    useMutation: useRefreshTokensMutation,
    createVariables: (refreshToken) => ({ refreshToken }),
    selectTokens: (data) => data?.refreshTokens,
  },
})
```

`selectTokens` should return `{ token, refreshToken? }`.

When authentication fails, the runtime can refresh the token, retry the original operation, and clear the session if refresh fails.

## 13. Get Refresh Token

```ts
import { getRefreshToken } from 'vue-apollo-client'

const refreshToken = getRefreshToken('auth_token')
```

## 14. Cookie Configuration

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  tokenKey: 'auth_token',
  tokenExpiration: 30,
  tokenCookie: {
    path: '/',
    sameSite: 'Lax',
  },
})
```

The default cookie settings adapt to HTTP/HTTPS automatically. `tokenExpiration` accepts a number of days or a `Date`.

# Request Configuration

## 15. Custom Headers / Context

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  setContext: ({ operationName, variables, token }) => ({
    headers: {
      'x-workspace-id': workspaceId.value,
      'x-operation-name': operationName,
    },
  }),
})
```

`setContext` receives `{ operationName, variables, token }`.

## 16. File Upload

GraphQL mutation:

```graphql
mutation UploadAvatar($file: Upload!) {
  uploadAvatar(file: $file) {
    url
  }
}
```

Use the generated mutation:

```ts
import { useUploadAvatarMutation } from './graphql/generated'

const { mutate } = useUploadAvatarMutation()
await mutate({ file: selectedFile })
```

Optional upload configuration:

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  apolloUploadConfig: {
    credentials: 'include',
  },
})
```

# SSR and Hydration

## 19. Basic SSR

Normal enabled queries are prefetched automatically in a managed SSR host:

```ts
const { result } = useGetUsersQuery()
```

There is no need to add `ssr: true`.

Disable SSR for one query:

```ts
const { result } = useGetUsersQuery({}, { ssr: false })
```

`defineApollo` handles the normal managed SSR and hydration lifecycle.

## 20. Advanced SSR

Use `createApollo` only when your integration owns the SSR lifecycle or needs to provide request state manually.

```ts
import { createApollo } from 'vue-apollo-client'

const runtime = createApollo(
  { endpoint: 'https://api.example.com/graphql' },
  {
    server: true,
    registerGlobal: false,
    headers: { cookie: request.headers.cookie ?? '' },
    signal: request.signal,
    initialState: previousApolloState,
  }
)

app.use(runtime)
```

Advanced runtime methods include `extract()`, `restore()`, `executeQuery()`, `executeMutation()`, `clearStore()`, and `stop()`.

# Configuration

Most applications only need `endpoint`. Add other options only when required.

## Common Options

| Option               | Description                    |
| -------------------- | ------------------------------ |
| `endpoint`           | Default GraphQL endpoint       |
| `endPoints`          | Multiple named endpoints       |
| `tokenKey`           | Access-token key               |
| `formatToken`        | Format authorization token     |
| `refresh`            | Refresh-token handling         |
| `allowOffline`       | Enable offline mutations       |
| `setContext`         | Add request headers/context    |
| `requestTimeoutMs`   | Request timeout                |
| `memoryConfig`       | Apollo cache configuration     |
| `useGETForQueries`   | Send queries with GET          |
| `apolloUploadConfig` | Upload transport configuration |

## All Options

| Option               | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `applicationId`      | Stable app identity for persisted state and SSR |
| `authBoundary`       | Separate authentication contexts                |
| `endpoint`           | One default GraphQL endpoint                    |
| `endPoints`          | Multiple named endpoints                        |
| `fetch`              | Custom `fetch` implementation                   |
| `requestTimeoutMs`   | Operation timeout                               |
| `tokenKey`           | Access-token key                                |
| `tokenCookie`        | Token-cookie attributes                         |
| `tokenExpiration`    | Token-cookie expiration                         |
| `memoryConfig`       | Apollo normalized cache settings                |
| `useGETForQueries`   | Send queries through GET                        |
| `apolloClientConfig` | Advanced Apollo Client options                  |
| `apolloUploadConfig` | Upload-link options                             |
| `allowOffline`       | Browser offline mutation queue                  |
| `getSessionId`       | Stable custom session identity                  |
| `refresh`            | Generated refresh-token contract                |
| `onLogout`           | Logout/auth failure callback                    |
| `getToken`           | Read from a custom token store                  |
| `clearToken`         | Clear a custom token store                      |
| `formatToken`        | Format the authorization value                  |
| `setContext`         | Per-operation Apollo context                    |

# Vite Plugin Options

```ts
vueApollo({
  documents: ['src/graphql/**/*.graphql'],
  schema: './schema.graphql',
  output: 'src/graphql/generated.ts',
  codegenConfig: {},
})
```

| Option          | Description                                               |
| --------------- | --------------------------------------------------------- |
| `documents`     | GraphQL operation glob(s)                                 |
| `schema`        | Local schema path or schema URL                           |
| `output`        | Generated file path                                       |
| `codegenConfig` | Additional GraphQL Code Generator config                  |
| `watch`         | Compatibility-only option; dev watching remains automatic |

# Advanced Configuration

## Apollo Cache

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  memoryConfig: {
    typePolicies: {
      User: {
        keyFields: ['id', 'workspaceId'],
      },
    },
  },
})
```

## Apollo Client Options

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  apolloClientConfig: {
    queryDeduplication: false,
    defaultOptions: {
      watchQuery: { fetchPolicy: 'cache-and-network' },
    },
  },
})
```

The package still owns its configured link and cache.

## Custom Token Store

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  getToken: () => authSdk.getAccessToken(),
  clearToken: () => authSdk.signOut(),
  getSessionId: () => authSdk.getStableSessionId(),
})
```

Use a stable login identity for `getSessionId`, not a rotating access token.

# API Reference

## Query APIs

| API                        | Purpose                      |
| -------------------------- | ---------------------------- |
| Generated `use<Name>Query` | Preferred typed query API    |
| `useQuery`                 | Lower-level query composable |
| `useLazyQuery`             | Deferred query execution     |
| `useMultiQuery`            | Combine generated queries    |

## Mutation APIs

| API                           | Purpose                         |
| ----------------------------- | ------------------------------- |
| Generated `use<Name>Mutation` | Preferred typed mutation API    |
| `useMutation`                 | Lower-level mutation composable |

## Authentication APIs

| API                 | Purpose                          |
| ------------------- | -------------------------------- |
| `useAuth`           | Authenticated user/session state |
| `createAuthRuntime` | Lower-level auth runtime         |
| `setToken`          | Save access/refresh tokens       |
| `getToken`          | Read access token                |
| `getRefreshToken`   | Read refresh token               |
| `removeToken`       | Remove access/refresh tokens     |

## Runtime APIs

| API                | Purpose                          |
| ------------------ | -------------------------------- |
| `defineApollo`     | Recommended app configuration    |
| `createApollo`     | Lower-level runtime / custom SSR |
| `useApolloRuntime` | Access the installed runtime     |

# Migration / Deprecated APIs

For new applications, prefer `defineApollo` plus generated composables.

| Legacy API                          | Use instead                                        |
| ----------------------------------- | -------------------------------------------------- |
| `getGlobalConfig`, `getClients`     | Installed runtime / `useApolloRuntime`             |
| `loadApolloClients()`               | `createApollo()`                                   |
| `setAuthRouter()`                   | `navigate` in `useAuth` / `createAuthRuntime`      |
| `UseAuthOptions.meQuery`            | Generated `useMeQuery`                             |
| `refresh.document`                  | `refresh.useMutation`                              |
| `refreshToken` callback             | Generated `refresh` contract                       |
| `refetchOnUpdate`, `refetchTimeout` | Reactive variables, fetch policies, or `refetch()` |

## License

MIT
