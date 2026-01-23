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
      entry: {
        'vue-apollo-client': path.resolve(__dirname, 'src/index.ts'),
        vite: path.resolve(__dirname, 'src/vite/index.ts'),
      },
      name: 'VueApolloClient',
      fileName: (format, entryName) => {
        const ext = format === 'es' ? 'mjs' : 'js'
        if (entryName === 'vite') {
             return `vite.${ext}`
        }
        return `vue-apollo-client.${ext}`
      },
    },
    rollupOptions: {
      external: [
          'vue', 
          'vue-router', 
          'graphql', 
          '@graphql-codegen/cli', 
          'vite', 
          'path', 
          'fs',
          'module'
      ], // Mark node-deps external
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
