import { describe, expect, it } from 'vitest'
import { vueApollo } from './index'

describe('vue-apollo Vite runtime ownership', () => {
  it('owns Apollo identity and SSR inlining defaults for consumers', async () => {
    const plugin = vueApollo()
    if (typeof plugin.config !== 'function') {
      throw new Error('vueApollo must expose a Vite config hook.')
    }
    const config = await plugin.config.call(
      {} as never,
      {},
      {
        command: 'serve',
        mode: 'test',
        isSsrBuild: true,
        isPreview: false,
      }
    ) as {
      resolve?: { dedupe?: string[] }
      ssr?: { noExternal?: Array<string | RegExp> }
    }

    expect(config.resolve?.dedupe).toContain('@apollo/client')
    expect(config.resolve?.dedupe).toContain('@vue/apollo-composable')
    expect(config.resolve?.dedupe).toContain('vue-apollo-client')
    expect(config.ssr?.noExternal).toContain('vue-apollo-client')
    expect(config.ssr?.noExternal).toContain('apollo-upload-client')
  })
})
