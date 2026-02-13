import { generate } from '@graphql-codegen/cli'
import { VueApolloViteOptions } from './types'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export const runCodegen = async (options: VueApolloViteOptions, rootDir: string) => {
  const schema = options.schema || 'http://localhost:4000/graphql'
  
  // Resolve the output path
  const outputRelative = options.output || 'src/graphql/generated.ts'
  const output = path.resolve(rootDir, outputRelative)

  // Normalize documents to an array
  let documents = options.documents || ['src/**/*.{graphql,gql,ts}']
  if (typeof documents === 'string') {
    documents = [documents]
  }

  // CRITICAL FIX: Exclude the output file from the documents list
  // This prevents the "Not all operations have an unique name" error
  // by ensuring the generator doesn't read its own output as an input source.
  const relativeOutputPath = path.relative(rootDir, output).split(path.sep).join('/')
  documents.push(`!${relativeOutputPath}`)

  try {
    const config = {
      schema,
      documents,
      generates: {
        [output]: {
          plugins: [
            require.resolve('@graphql-codegen/typescript'),
            require.resolve('@graphql-codegen/typescript-operations'),
            require.resolve('@graphql-codegen/typescript-vue-apollo'),
          ],
          config: {
            // Point to this library for composables
            vueApolloComposableImportFrom: 'vue-apollo-client',
            vueCompositionApiImportFrom: 'vue',
            // Default configs
            skipTypename: false,
            withHooks: true,
            withHOC: false,
            withComponent: false,
            ...options.codegenConfig,
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

