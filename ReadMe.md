
# Vue Apollo Client

A Vue 3 compatible wrapper for Apollo Client, ported from `nuxt-apollo-client`.
It provides features like Smart Queries (caching/refetching), SSR support, Offline Mutations, and **Zero-Config Codegen**.

## Installation

```bash
npm install vue-apollo-client @apollo/client graphql @vue/apollo-composable
npm install -D @graphql-codegen/cli
```

## Setup (Vite Plugin - Recommended)

To enable automatic codegen without manual configuration, add the Vite plugin:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig({
  plugins: [
    vue(),
    vueApollo({
       // Optional: Defaults are smart enough
       // documents: 'src/**\/*.graphql', 
       // output: 'src/graphql/generated.ts'
    })
  ]
})
```

Now, just run `npm run dev`. The plugin will:
1. Scan for `.graphql` files.
2. Generate typed hooks in `src/graphql/generated.ts`.
3. Watch for changes and regenerate automatically.

## App Usage

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
  allowOffline: true,
})

app.use(apollo)
app.mount('#app')
```

## Using Generated Hooks

Once you have your `.graphql` files, imports are auto-generated.

```graphql
# src/graphql/user.graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    name
  }
}
```

Use it in your component:

```vue
<script setup>
import { useGetUserQuery } from './graphql/generated'

const { result } = useGetUserQuery({ id: '1' })
</script>
```

No manual codegen config required!

## Manual Setup

If you prefer manual control, see [Legacy Setup](#manual-setup-legacy).
