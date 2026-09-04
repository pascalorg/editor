import { describe, expect, test } from 'bun:test'
import { treesHostPanel, treesPlugin } from './index'

describe('Nature plugin manifest', () => {
  test('exports the stable plugin identity and node kinds', () => {
    expect(treesPlugin.id).toBe('pascal:trees')
    expect(treesPlugin.apiVersion).toBe(1)
    expect(treesPlugin.nodes?.map((definition) => definition.kind)).toEqual([
      'trees:tree',
      'trees:flower',
      'trees:grass',
    ])
  })

  test('associates the Nature panel with the plugin', () => {
    expect(treesHostPanel.pluginId).toBe(treesPlugin.id)
    expect(treesHostPanel.defaultInstalled).toBe(true)
    expect(treesHostPanel.pluginUrl).toBe('https://github.com/pascalorg/plugin-trees')
  })
})
