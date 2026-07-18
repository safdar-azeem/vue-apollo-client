import { generate } from '@graphql-codegen/cli'
import { VueApolloViteOptions } from './types'
import path from 'path'
import { createRequire } from 'module'
import { readdir, readFile } from 'node:fs/promises'
import { Kind, parse } from 'graphql'

const require = createRequire(import.meta.url)

const validateOperationSources = async (rootDir: string) => {
  const sourceRoot = path.resolve(rootDir, 'src')
  const operationNames = new Map<string, string>()
  const visit = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    await Promise.all(entries.map(async (entry) => {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) return visit(filename)
      if (!entry.isFile() || !/\.(graphql|gql)$/i.test(entry.name)) return
      const document = parse(await readFile(filename, 'utf8'))
      for (const definition of document.definitions) {
        if (definition.kind !== Kind.OPERATION_DEFINITION) continue
        const name = definition.name?.value
        const relative = path.relative(rootDir, filename).split(path.sep).join('/')
        if (!name) throw new Error(`Anonymous GraphQL operation in ${relative}.`)
        const previous = operationNames.get(name)
        if (previous) {
          throw new Error(
            `Duplicate GraphQL operation "${name}" in ${previous} and ${relative}.`
          )
        }
        operationNames.set(name, relative)
      }
    }))
  }
  await visit(sourceRoot)
}

export const runCodegen = async (options: VueApolloViteOptions, rootDir: string) => {
  await validateOperationSources(rootDir)
  const schema = options.schema || 'http://localhost:4000/graphql'
  
  // Resolve the output path
  const outputRelative = options.output || 'src/graphql/generated.ts'
  const output = path.resolve(rootDir, outputRelative)

  // Normalize documents to an array
  const configuredDocuments =
    options.documents || ['src/**/*.{graphql,gql}']
  const documents =
    typeof configuredDocuments === 'string'
      ? [configuredDocuments]
      : [...configuredDocuments]

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
            { add: { content: '// @ts-nocheck\n/* eslint-disable */\n' } },
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
    console.log(`✓ GraphQL types generated → ${relativeOutputPath}`)
  } catch (error) {
    console.error('✗ GraphQL codegen failed', error)
    throw error
  }
}
