export interface VueApolloViteOptions {
  /**
   * Path to GraphQL files or pattern
   * @default 'src/**\/*.{graphql,gql}'
   */
  documents?: string | string[]

  /**
   * Path to the schema file or URL
   * @default 'http://localhost:4000/graphql'
   */
  schema?: string | string[]

  /**
   * Directory where generated files will be placed.
   * By default, it generates `generated.ts` next to the usage or a central file.
   * @default 'src/graphql/generated.ts'
   */
  output?: string

  /**
   * Enable/Disable file watching
   * @default true
   */
  watch?: boolean

  /**
   * Additional plugins or config for codegen
   */
  codegenConfig?: Record<string, any>
}
