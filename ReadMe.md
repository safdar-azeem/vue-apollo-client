
# Vue Apollo Client

A Vue 3 compatible wrapper for Apollo Client, ported from `nuxt-apollo-client`.
It provides features like Smart Queries (caching/refetching), SSR support, Offline Mutations, and easy integration.

## Installation

```bash
npm install vue-apollo-client @apollo/client graphql @vue/apollo-composable
```

## Setup

In your main entry file (e.g., `main.ts`):

```typescript
import { createApp } from 'vue'
import { createApollo } from 'vue-apollo-client'
import App from './App.vue'

const app = createApp(App)

const apollo = createApollo({
  endPoints: {
    default: 'http://localhost:4000/graphql',
  },
  tokenKey: 'auth_token',
  // Optional: Global refetch settings
  refetchOnUpdate: true,
  refetchTimeout: 10000,
  // Optional: Offline support
  allowOffline: true,
})

app.use(apollo)
app.mount('#app')
```

## Usage

### Smart Query (`useQuery`)

The `useQuery` exported from this package includes "Smart Query" features:
- Automatic refetching when variables change (debounced).
- Caching logic to prevent over-fetching.
- SSR support (awaits data on server).

```vue
<script setup>
import { useQuery } from 'vue-apollo-client'
import { GET_USER } from './graphql'

const { result, loading, error } = useQuery(GET_USER, { id: 1 })
</script>
```

### Lazy Query

```vue
<script setup>
import { useLazyQuery } from 'vue-apollo-client'

const { load, result, loading } = useLazyQuery(GET_USER)

const fetchUser = () => {
    load(GET_USER, { id: 1 })
}
</script>
```

### Mutations (Offline Support)

If `allowOffline` is enabled in config, mutations will be queued in `localStorage` when offline and synced when back online.

```vue
<script setup>
import { useMutation } from 'vue-apollo-client'
import { UPDATE_USER } from './graphql'

const { mutate } = useMutation(UPDATE_USER)

const save = async () => {
    await mutate({ name: 'New Name' })
}
</script>
```

### Multi Query

Combine multiple queries into one loading state.

```vue
<script setup>
import { useMultiQuery } from 'vue-apollo-client'
import * as operations from './graphql/generated'

const { result, loading } = useMultiQuery(operations, ['GetUser', 'GetPosts'])
</script>
```

## Codegen

To use `graphql-codegen` with type-safe hooks that use **this library** (instead of standard `@vue/apollo-composable`), configure your `codegen.ts`:

```typescript
import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: 'http://localhost:4000/graphql',
  documents: 'src/**/*.graphql',
  generates: {
    'src/graphql/generated.ts': {
      plugins: ['typescript', 'typescript-operations', 'typescript-vue-apollo'],
      config: {
        vueCompositionApiImportFrom: 'vue',
        vueApolloComposableImportFrom: 'vue-apollo-client', // <--- IMPORTANT: Point to this lib
      },
    },
  },
}
export default config
```

This ensures `useGetUserQuery` will use our Smart Query implementation.
