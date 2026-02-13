# Vue Apollo Client

A Vue 3 Apollo Client featuring smart queries with caching and refetching, SSR support, offline mutations, and **zero-config code generation**.

## Features

- Apollo Client integration with Vue 3
- Server-Side Rendering (SSR) support
- GraphQL Code Generator integration
- Offline support (mutations)
- Multiple client support
- File Upload support
- Automatic token management
- Automatic type generation for queries and mutations
- Auto-imports for generated composables and types
- Production-ready 📦

## Installation

```bash
npm install vue-apollo-client @apollo/client graphql vue-router @vue/apollo-composable
# or
yarn add vue-apollo-client @apollo/client graphql vue-router @vue/apollo-composable
```

## Setup

### 1. Vite Plugin

To enable automatic codegen without manual configuration, add the Vite plugin. This will scan your `.graphql` files and generate typed composables automatically.

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig({
  plugins: [
    vue(),
    vueApollo({
      // Optional configuration
      // documents: 'src/**/*.graphql',
      // schema: 'http://localhost:4000/graphql'
    }),
  ],
})
```

Now, just run `npm run dev`. The plugin will:

1. Scan for `.graphql` files.
2. Generate typed hooks in `src/graphql/generated.ts`.
3. Watch for changes and regenerate automatically.

### 2. App Initialization

In your main entry file (e.g., `main.ts`), initialize the Apollo client:

```typescript
import { createApp } from 'vue'
import { createApollo } from 'vue-apollo-client'
import App from './App.vue'

const app = createApp(App)

const apollo = createApollo({
  endPoints: {
    default: 'http://localhost:4000/graphql',
    // Add more endpoints as needed
  },
  tokenKey: 'auth_token',
  allowOffline: true,
})

app.use(apollo)
app.mount('#app')
```

## Usage

Use auto-generated composables in your Vue component.

### Server-side Query (SSR)

If you are using this with SSR (e.g. `vite-ssr` or custom setup), you can await the query to fetch data on the server.

```vue
<script setup>
import { useMeQuery } from './graphql/generated'

// Await the result for SSR pre-fetching
const { result, loading, error, refetch } = await useMeQuery()
</script>

<template>
  <div v-if="result">Welcome, {{ result.me.name }}!</div>
</template>
```

### Client-side Query

For standard client-side fetching:

```vue
<script setup>
import { useMeQuery } from './graphql/generated'

const { result, loading, error, refetch } = useMeQuery()
</script>
```

### Dynamic Refetching Query

You can pass reactive variables (`ref`, `reactive`, `computed`) to the query. The hook will automatically refetch when variables change.

```vue
<script setup>
import { ref, computed } from 'vue'
import { useGetUserQuery } from './graphql/generated'

const userId = ref('1')

// Automatically refetches when userId changes
const { result } = useGetUserQuery({ id: userId })

// Or with computed
const { result: otherResult } = useGetUserQuery({ id: computed(() => '2') })
</script>
```

### Multple Queries

The `useMultiQuery` composable allows you to combine multiple GraphQL queries into a single loading/error state.
**Note**: Unlike the Nuxt version, you must pass the generated query hooks code map (or object containing them) if you want to use them by key, or pass the functions directly.

```typescript
import { useMultiQuery } from 'vue-apollo-client'
import * as queries from './graphql/generated' // Import all generated hooks

const { result, loading, error, refetch } = useMultiQuery(
  queries,
  ['useGetUserQuery', 'useMeQuery'], // Keys must match exported names
  {
    /* shared variables */
  },
  {
    /* options */
  }
)

const users = result.value?.getUser
const me = result.value?.me
```

### Mutations

```vue
<script setup lang="ts">
import { useDeletePostMutation } from './graphql/generated'

const { mutate, loading, error, onDone, onError } = useDeletePostMutation()

const handleDelete = async (id: string) => {
  await mutate({ id })
  // Handle successful deletion
}
</script>
```

## Configuration Options

Pass these options to `createApollo()`:

| Option             | Type                        | Description                                                                                      | Default                                        |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| endPoints          | `Record<string, string>`    | GraphQL endpoint URLs                                                                            | `{ default: 'http://localhost:4000/graphql' }` |
| tokenKey           | `string`                    | Key for storing the authentication token in cookies                                              | `'token'`                                      |
| tokenExpiration    | `number/Date`               | When the token expires.                                                                          | 30 days                                        |
| memoryConfig       | `InMemoryCacheConfig`       | Memory cache config for Apollo Client                                                            | `{}`                                           |
| useGETForQueries   | `boolean`                   | Use GET for queries                                                                              | `false`                                        |
| apolloClientConfig | `ApolloClientOptions<any>`  | Apollo Client config                                                                             | `null`                                         |
| apolloUploadConfig | `ApolloUploadClientOptions` | Apollo Upload Client config                                                                      | `{}`                                           |
| refetchOnUpdate    | `boolean`                   | Smartly Refetch queries on component, page, or route changes.                                    | `false`                                        |
| refetchTimeout     | `number`                    | Time in milliseconds to wait before refetching a query after a component, page, or route change. | `10000`                                        |
| allowOffline       | `boolean`                   | Queue mutations when offline and sync when online.                                               | `false`                                        |
| setContext         | `function`                  | method to setup context                                                                          | `({operationName, variables, token}) => any`   |

## Functions

| Function           | Description                                                   | Syntax                                                           |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| setToken           | Sets the token and refresh token in the cookie                | `setToken(token)` or `setToken({ token, refreshToken })`         |
| getToken           | Gets the token from the cookie                                | `getToken(key?)`                                                 |
| getRefreshToken    | Gets the refresh token from the cookie                        | `getRefreshToken(key?)`                                          |
| removeToken        | Removes the token and refresh token from the cookie           | `removeToken(key?, options?)`                                    |
| loadApolloClients  | Initializes Apollo Clients for use outside components         | `loadApolloClients()`                                            |
| useKeepCookieAlive | Keeps the auth token cookie alive by updating it periodically | `useKeepCookieAlive(debounceMs?: number)` (defaults to 10000 ms) |

### Refresh Token Support

The client automatically handles `UNAUTHENTICATED` (401) errors. If a request fails with a 401, it attempts to refresh the token using the stored refresh token.

1. It calls a `refreshToken` mutation on your backend.
2. If successful, it updates the cookies and retries the original request.
3. If valid tokens are not returned, it logs the user out.

To enable this, ensure your login flow saves the refresh token:

```typescript
import { setToken } from 'vue-apollo-client'

// On login success
setToken({
  token: 'new-access-token',
  refreshToken: 'new-refresh-token',
})
```

### Cookie Management & Security

`vue-apollo-client` automatically sets secure defaults for cookies (`SameSite=None`, `Secure`, `Path=/`) when using `setToken`.

```typescript
import { setToken, useKeepCookieAlive } from 'vue-apollo-client'

// Login
setToken('jwt-token')

// Monitor activity to keep session alive
useKeepCookieAlive()
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
