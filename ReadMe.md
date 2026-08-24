# Vue Apollo Client

## Description

Vue Apollo Client is a Vue 3 Apollo integration with GraphQL code generation,
typed composables, caching, authentication, SSR, and offline mutation support.

The basic setup only requires one GraphQL endpoint. Advanced features are
documented at the end.

## Installation

```bash
npm install vue-apollo-client
```

## Setup

### 1. Add the Vite plugin

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig({
  plugins: [vue(), vueApollo()],
})
```

The plugin generates typed composables from GraphQL files in
`src/**/*.{graphql,gql}` and writes them to `src/graphql/generated.ts`.

### 2. Add the GraphQL endpoint

```bash
# .env
VITE_GRAPHQL_ENDPOINT=https://api.example.com/graphql
```

### 3. Create the Apollo configuration

```typescript
// src/config/apollo.ts
import { defineApollo } from 'vue-apollo-client'

export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
})
```

### 4. Install the configuration

```typescript
// src/main.ts
import { createApp } from 'vue'
import App from './App.vue'
import apollo from './config/apollo'

const app = createApp(App)

app.use(apollo)
app.mount('#app')
```

Run the development server to generate the GraphQL composables:

```bash
npm run dev
```

Commit `src/graphql/generated.ts` so production builds do not need to access
the GraphQL schema.

## Configuration

### Basic configuration

For a small application, this is usually all you need:

```typescript
import { defineApollo } from 'vue-apollo-client'

export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
})
```

### Common options

| Option | Description | Default |
| --- | --- | --- |
| `endpoint` | GraphQL endpoint for the application | `http://localhost:4000/graphql` |
| `tokenKey` | Cookie key for the access token | `'token'` |
| `formatToken` | Formats the authorization header value | Identity function |
| `requestTimeoutMs` | Request timeout in milliseconds | Disabled |

## Usage

### Query data

Create a GraphQL operation:

```graphql
# src/graphql/users.graphql
query GetUsers {
  users {
    id
    name
  }
}
```

Use the generated composable in a component:

```vue
<script setup lang="ts">
import { useGetUsersQuery } from './graphql/generated'

const { result, loading, error, refetch } = useGetUsersQuery()
</script>

<template>
  <p v-if="loading">Loading…</p>
  <p v-else-if="error">Could not load users.</p>

  <ul v-else>
    <li v-for="user in result?.users ?? []" :key="user.id">
      {{ user.name }}
    </li>
  </ul>

  <button type="button" @click="refetch">Reload</button>
</template>
```

### Query variables

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    name
  }
}
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useGetUserQuery } from './graphql/generated'

const userId = ref('user-1')
const { result } = useGetUserQuery({ id: userId })
</script>
```

Reactive variables automatically trigger a new request when they change.

### Mutations

```graphql
mutation CreateUser($name: String!) {
  createUser(name: $name) {
    id
    name
  }
}
```

```vue
<script setup lang="ts">
import { useCreateUserMutation } from './graphql/generated'

const { mutate, loading, error } = useCreateUserMutation()

const createUser = () => mutate({ name: 'Ada Lovelace' })
</script>

<template>
  <button type="button" :disabled="loading" @click="createUser">
    Create user
  </button>
  <p v-if="error">Could not create user.</p>
</template>
```

Refresh active queries after a mutation with `refetchQueries`:

```typescript
await mutate(
  { name: 'Ada Lovelace' },
  { refetchQueries: ['GetUsers'] }
)
```

### Authentication

If your API requires an access token, configure a token key. Use
`formatToken` when your API expects the standard Bearer format.

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  tokenKey: 'auth_token',
  formatToken: (token) => `Bearer ${token}`,
})
```

Refresh tokens are not required. A small application can save only the access
token and ask the user to sign in again when it expires.

Save the access token after a login mutation succeeds:

```typescript
import { setToken } from 'vue-apollo-client'

setToken('access-token-from-login')
```

If your application has a `me` query, use `useAuth` for shared user state and
session verification. Call it inside a Vue component's `<script setup>` or a
composable after `app.use(apollo)` has installed the Apollo runtime:

```typescript
import { useAuth } from 'vue-apollo-client'
import { useMeQuery } from './graphql/generated'

const { user, isAuthenticated, verify, logout } = useAuth({
  useMeQuery,
  loginRoute: '/login',
  navigate: (path) => router.push(path),
})

await verify()
```

## Advanced configuration

Use these options only when your application needs them.

### Refresh tokens

Save both tokens after login:

```typescript
import { setToken } from 'vue-apollo-client'

setToken({
  key: 'auth_token',
  token: 'access-token',
  refreshToken: 'refresh-token',
})
```

Configure the generated refresh mutation:

```typescript
import { defineApollo } from 'vue-apollo-client'
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

The client refreshes the token after an authentication failure and retries the
original request. If refresh fails, the tokens and Apollo cache are cleared.

### Multiple GraphQL clients

```typescript
export default defineApollo({
  endPoints: {
    default: 'https://api.example.com/graphql',
    admin: 'https://admin.example.com/graphql',
  },
})
```

Select a client in a generated composable:

```typescript
const { result } = useGetUsersQuery({}, { clientId: 'admin' })
```

Do not use `endpoint` and `endPoints` together.

### Offline mutations

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  allowOffline: true,
})
```

Offline mutations are queued in `localStorage` and synchronized when the
browser reconnects. Use this only for mutations that can safely be replayed.

### SSR and hydration

The same `defineApollo` plugin can be used by a managed SSR host. Enable server
prefetch for a query with `ssr: true`:

```typescript
const { result } = useGetUsersQuery(
  {},
  { ssr: true, fetchPolicy: 'cache-first' }
)
```

The package creates request-isolated clients, transfers the Apollo cache to the
browser, and prevents duplicate requests during hydration.

### Custom token stores and cookies

Use a custom token store when tokens are managed by another auth system:

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  getToken: () => authSdk.getAccessToken(),
  clearToken: () => authSdk.signOut(),
})
```

Use `tokenCookie` to configure cookie attributes. Cookies are host-only by
default; set `domain` explicitly when sharing authentication across subdomains.

If a custom token store is used together with refresh tokens, also provide
`refresh.getRefreshToken`, `refresh.persistTokens`, and `refresh.clearTokens`.

### Compatibility API

`createApollo` is available for package integrations and custom SSR hosts:

```typescript
import { createApollo } from 'vue-apollo-client'

const runtime = createApollo(
  { endPoints: { default: 'https://api.example.com/graphql' } },
  { server: true, registerGlobal: false }
)

app.use(runtime)
```

Normal applications should use `defineApollo` and generated composables.

## License

MIT
