import { loadEnv, type Plugin, type ViteDevServer } from 'vite'
import type { VueApolloViteOptions } from './types'
import { runCodegen } from './codegen'
import { shouldRunLiveCodegen } from './VueApolloViteCodegenGate'
import path from 'path'

const APOLLO_DEDUPE = [
  '@apollo/client',
  '@vue/apollo-composable',
  'graphql',
  'graphql-tag',
  'vue-apollo-client',
]

const APOLLO_SSR_NO_EXTERNAL: Array<string | RegExp> = [
  ...APOLLO_DEDUPE,
  'apollo-upload-client',
  'optimism',
  'ts-invariant',
  /^@wry\//,
]

export function vueApollo(options: VueApolloViteOptions = {}): Plugin {
  let root = process.cwd()
  let codegenOptions = options
  let liveCodegen = true
  let timer: any = null

  // Debounce helper to prevent multiple rapid runs
  const debouncedCodegen = () => {
    if (!liveCodegen) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      // Watch-mode failures are already logged by runCodegen; the next edit
      // must remain retryable without creating an unhandled rejection.
      void runCodegen(codegenOptions, root).catch(() => undefined)
    }, 200)
  }

  const toRelative = (file: string) =>
    path.relative(root, file).split(path.sep).join('/')

  // Helper to check if a file should trigger codegen
  const shouldTriggerCodegen = (file: string) => {
    const output = options.output
      ? path.resolve(root, options.output)
      : path.resolve(root, 'src/graphql/generated.ts')

    // Prevent infinite loop by ignoring the output file itself
    if (file === output) return false

    return file.endsWith('.graphql') || file.endsWith('.gql')
  }

  return {
    name: 'vue-apollo-dts',
    config() {
      return {
        resolve: { dedupe: APOLLO_DEDUPE },
        ssr: { noExternal: APOLLO_SSR_NO_EXTERNAL },
      }
    },
    configResolved(config) {
      root = config.root
      if (options.schema === undefined) {
        const loadedEnv = loadEnv(config.mode, config.root, 'VITE_')
        const explicitEndpoint =
          config.env?.VITE_GRAPHQL_ENDPOINT?.trim() || loadedEnv.VITE_GRAPHQL_ENDPOINT?.trim()
        const apiUrl =
          config.env?.VITE_API_URL?.trim() || loadedEnv.VITE_API_URL?.trim()
        codegenOptions = {
          ...options,
          schema:
            explicitEndpoint ||
            (apiUrl ? `${apiUrl}/graphql` : 'http://localhost:4000/graphql'),
        }
      }
      // `vite build` (client + SSR) skips remote schema fetch / codegen.
      // `vite` / `vite dev` keep the existing live codegen behaviour.
      liveCodegen = shouldRunLiveCodegen(config.command)
    },
    // Hook into the server watcher to handle file additions/removals
    configureServer(server: ViteDevServer) {
      server.watcher.on('add', (file) => {
        if (shouldTriggerCodegen(file)) {
          console.log(`➜ GraphQL file added → ${toRelative(file)}`)
          debouncedCodegen()
        }
      })
      server.watcher.on('unlink', (file) => {
        if (shouldTriggerCodegen(file)) {
          console.log(`➜ GraphQL file removed → ${toRelative(file)}`)
          debouncedCodegen()
        }
      })
    },
    async buildStart() {
      if (!liveCodegen) return
      await runCodegen(codegenOptions, root)
    },
    // Handle file updates (HMR)
    handleHotUpdate({ file }) {
      if (shouldTriggerCodegen(file)) {
        console.log(`➜ GraphQL file changed → ${toRelative(file)}`)
        debouncedCodegen()
      }
    },
  }
}
