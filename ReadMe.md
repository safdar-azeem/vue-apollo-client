# Vue Apollo Client

A Vue 3 compatible wrapper for Apollo Client.
It provides features like Smart Queries (caching/refetching), SSR support, Offline Mutations, and **Zero-Config Codegen**.

## Installation

```bash
npm install vue-apollo-client @apollo/client graphql vue-router @vue/apollo-composable
```

## Setup (Vite Plugin)

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
		}),
	],
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
import { createApollo, setToken } from 'vue-apollo-client'
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

## Features

### Authentication & Cookies

`vue-apollo-client` handles authentication cookies for you.

```typescript
import {
	setToken,
	removeToken,
	getToken,
	useKeepCookieAlive,
} from 'vue-apollo-client'

// Set token with default secure options (SameSite=None, Secure, etc.)
setToken('my-jwt-token')

// Keep the cookie alive (refresh expiration) on user activity
useKeepCookieAlive()
```

### Using Generated Hooks

Once you have your `.graphql` files, imports are auto-generated.

```vue
<script setup>
import { useGetUserQuery } from './graphql/generated'

const { result } = useGetUserQuery({ id: '1' })
</script>
```

### Offline Mutations

If `allowOffline: true` is set, mutations performed while offline will be queued and synced when the connection is restored.

### Multi Query

Combine multiple queries into one loading state.

```typescript
import { useMultiQuery } from 'vue-apollo-client'
// See documentation for usage
```

## License

MIT
