/**
 * Live GraphQL codegen (remote schema fetch + document generation) is a
 * development concern. Vite production / SSR builds must use the committed
 * generated types so image builds do not depend on a reachable API schema.
 */
export function shouldRunLiveCodegen(command: 'build' | 'serve'): boolean {
  return command === 'serve'
}
