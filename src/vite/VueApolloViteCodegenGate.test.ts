import { describe, expect, it } from 'vitest'
import { shouldRunLiveCodegen } from './VueApolloViteCodegenGate'

describe('shouldRunLiveCodegen', () => {
  it('runs live codegen during Vite serve / dev', () => {
    expect(shouldRunLiveCodegen('serve')).toBe(true)
  })

  it('skips live codegen during Vite build (client and SSR)', () => {
    expect(shouldRunLiveCodegen('build')).toBe(false)
  })
})
