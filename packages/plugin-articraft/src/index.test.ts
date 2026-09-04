import { describe, expect, test } from 'bun:test'
import { ARTICRAFT_ICON } from './brand'
import { articraftHostPanel, articraftPlugin } from './index'

describe('Articraft plugin manifest', () => {
  test('exports one stable custom node kind', () => {
    expect(articraftPlugin.id).toBe('pascal:articraft')
    expect(articraftPlugin.apiVersion).toBe(1)
    expect(articraftPlugin.nodes?.map((definition) => definition.kind)).toEqual(['articraft:asset'])
  })

  test('associates the host panel and kind with the plugin', () => {
    expect(articraftHostPanel.pluginId).toBe(articraftPlugin.id)
    expect(articraftHostPanel.kinds).toEqual(['articraft:asset'])
    expect(articraftHostPanel.icon).toBe(ARTICRAFT_ICON)
    expect(articraftHostPanel.pluginUrl).toBe('https://github.com/pascalorg/plugin-articraft')
  })
})
