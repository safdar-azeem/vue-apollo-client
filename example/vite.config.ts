import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const graphqlEndpoint = env.VITE_GRAPHQL_ENDPOINT || 'http://localhost:4000/graphql'

  return {
    server: {
      port: 5173,
      strictPort: true,
    },
    plugins: [
      vue(),
      vueApollo({
        schema: graphqlEndpoint,
        documents: ['src/graphql/**/*.graphql'],
        output: 'src/graphql/generated.ts',
      }),
    ],
  }
})
