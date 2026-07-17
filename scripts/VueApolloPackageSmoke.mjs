const library = await import('../dist/vue-apollo-client.mjs')

if (typeof library.createApollo !== 'function') {
  throw new Error('The ESM package entry does not export createApollo().')
}

if (typeof library.useQuery !== 'function') {
  throw new Error('The ESM package entry does not export useQuery().')
}

console.log('[vue-apollo-client] ESM package import passed')
