import type { Plugin, ViteDevServer } from 'vite'
import { VueApolloViteOptions } from './types'
import { runCodegen } from './codegen'
import path from 'path'

export function vueApollo(options: VueApolloViteOptions = {}): Plugin {
  let root = process.cwd()
  let timer: any = null

  // Debounce helper to prevent multiple rapid runs
  const debouncedCodegen = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      runCodegen(options, root)
    }, 200)
  }

  // Helper to check if a file should trigger codegen
  const shouldTriggerCodegen = (file: string) => {
    const output = options.output
      ? path.resolve(root, options.output)
      : path.resolve(root, 'src/graphql/generated.ts')

    // Prevent infinite loop by ignoring the output file itself
    if (file === output) return false

    return file.endsWith('.graphql') || file.endsWith('.gql') || file.endsWith('.ts')
  }

  return {
    name: 'vue-apollo-dts',
    configResolved(config) {
      root = config.root
    },
    // Hook into the server watcher to handle file additions/removals
    configureServer(server: ViteDevServer) {
      server.watcher.on('add', (file) => {
        if (shouldTriggerCodegen(file)) {
          console.log(`[vue-apollo] File added: ${file}, running codegen...`)
          debouncedCodegen()
        }
      })
      server.watcher.on('unlink', (file) => {
        if (shouldTriggerCodegen(file)) {
          console.log(`[vue-apollo] File removed: ${file}, running codegen...`)
          debouncedCodegen()
        }
      })
    },
    async buildStart() {
      // Initial run
      await runCodegen(options, root)
    },
    // Handle file updates (HMR)
    handleHotUpdate({ file }) {
      if (shouldTriggerCodegen(file)) {
        console.log(`[vue-apollo] File changed: ${file}, running codegen...`)
        debouncedCodegen()
      }
    },
  }
}

