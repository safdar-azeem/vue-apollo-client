import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'node:url'
import dts from 'vite-plugin-dts'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: {
        'vue-apollo-client': path.resolve(root, 'src/index.ts'),
        vite: path.resolve(root, 'src/vite/index.ts'),
      },
      name: 'VueApolloClient',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        const ext = format === 'es' ? 'mjs' : 'cjs'
        if (entryName === 'vite') {
          return `vite.${ext}`
        }
        return `vue-apollo-client.${ext}`
      },
    },
    rollupOptions: {
      external: [
        /^node:/,
        /^@apollo\/client(?:\/.*)?$/,
        '@vue/apollo-composable',
        'vue',
        'vue-router',
        'graphql',
        'graphql-tag',
        '@graphql-codegen/cli',
        'vite',
        'path',
        'fs',
        'module',
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
