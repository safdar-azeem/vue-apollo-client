
import { generate } from '@graphql-codegen/cli'
import { VueApolloViteOptions } from './types'
import path from 'path'

export const runCodegen = async (options: VueApolloViteOptions, rootDir: string) => {
  const schema = options.schema || 'http://localhost:4000/graphql'
  const documents = options.documents || 'src/**/*.{graphql,gql,ts}'
  const output = options.output ? path.resolve(rootDir, options.output) : path.resolve(rootDir, 'src/graphql/generated.ts')
  
  try {
    const config = {
      schema,
      documents,
      generates: {
        [output]: {
          plugins: [
            'typescript',
            'typescript-operations',
            'typescript-vue-apollo',
          ],
          config: {
            // CRITICAL: Point to this library for composables
            vueApolloComposableImportFrom: 'vue-apollo-client',
            vueCompositionApiImportFrom: 'vue',
            // Default configs
            skipTypename: false,
            withHooks: true,
            withHOC: false,
            withComponent: false,
            ...options.codegenConfig
          },
        },
      },
      silent: true,
    }

    await generate(config, true)
    console.log(`[vue-apollo] Generated GraphQL types at ${output}`)
  } catch (error) {
    console.error('[vue-apollo] Codegen failed:', error)
  }
}
