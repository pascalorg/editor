import { afterEach, beforeEach, expect, test } from 'bun:test'
import { AnyNode, loadPlugin, nodeRegistry } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'
import { renderPlugin } from '@pascal-app/nodes/render'

let restore = () => {}
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
})
afterEach(() => restore())

test.each([
  ['editor', builtinPlugin],
  ['render', renderPlugin],
] as const)(
  '%s registers the Site garden kinds with loadable defaults and read-only geometry',
  async (_name, plugin) => {
    await loadPlugin(plugin)
    for (const kind of ['hedge', 'planting', 'tree', 'lawn'] as const) {
      expect(plugin.nodes!.filter((definition) => definition.kind === kind)).toHaveLength(1)
      const definition = nodeRegistry.get(kind)!
      expect(definition.capabilities.hostable?.parents).toEqual(['site'])
      expect(definition.floorplanScope).toBe('site')
      expect(typeof definition.geometry).toBe('function')
      expect(typeof definition.floorplan).toBe('function')
      const node = AnyNode.parse({
        ...definition.defaults(),
        id: `${kind}_registered`,
        type: kind,
        parentId: 'site_garden',
      })
      expect(node.type).toBe(kind)
      if (node.type === 'hedge') expect(node.gen).toBe(2)
      if (node.type === 'tree') expect(node.gen).toBe(1)
      if (node.type === 'lawn') {
        expect(node.gen).toBe(1)
        expect(node.height).toBe(0.06)
        expect(node.flowerDensity).toBe(0)
      }
      if (node.type === 'planting') {
        expect(node.gen).toBe(1)
        expect(new Set(node.plants.map((plant) => plant.layer))).toEqual(
          new Set(['back', 'mid', 'edge']),
        )
      }
    }
  },
)
