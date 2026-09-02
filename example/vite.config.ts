import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [
    vue(),
    vueApollo({
      schema: './src/graphql/schema.graphql',
      documents: ['src/graphql/operations/**/*.graphql'],
      output: 'src/graphql/generated.ts',
    }),
  ],
})
