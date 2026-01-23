import { defineConfig } from 'vite'
import path from 'path'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'VueApolloClient',
      fileName: (format) => `vue-apollo-client.${format === 'es' ? 'mjs' : 'umd.js'}`,
    },
    rollupOptions: {
      external: ['vue', 'vue-router', 'graphql'],
      output: {
        globals: {
          vue: 'Vue',
          'vue-router': 'VueRouter',
          graphql: 'GraphQL',
        },
      },
    },
  },
})
