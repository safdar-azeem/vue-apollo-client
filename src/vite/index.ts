import type { Plugin } from 'vite'
import { VueApolloViteOptions } from './types'
import { runCodegen } from './codegen' // Assuming synchronous or handled async
import path from 'path'

export function vueApollo(options: VueApolloViteOptions = {}): Plugin {
  let root = process.cwd()

  // Debounce helper
  let timer: any = null
  const debouncedCodegen = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      runCodegen(options, root)
    }, 200)
  }

  return {
    name: 'vue-apollo-dts',
    configResolved(config) {
      root = config.root
    },
    async buildStart() {
      // Initial run
      await runCodegen(options, root)
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.graphql') || file.endsWith('.gql') || file.endsWith('.ts')) {
        // If it's a TS file, we should be careful not to infinite loop if it's the generated file
        // generated file location:
        const output = options.output
          ? path.resolve(root, options.output)
          : path.resolve(root, 'src/graphql/generated.ts')

        if (file === output) {
          return
        }

        // Also check if TS file looks like a schema definition or just app logic?
        // Nuxt module watches everything. But efficient watching is better.
        // For now, let's just trigger.
        console.log(`[vue-apollo] File changed: ${file}, running codegen...`)
        debouncedCodegen()
      }
    },
  }
}
