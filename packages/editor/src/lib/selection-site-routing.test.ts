import { expect, test } from 'bun:test'
import {
  BuildingNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  WallNode,
} from '@pascal-app/core'
import { isSelectableSiteNode } from './selection-routing'

for (const ownership of ['other-level', 'orphan', 'missing-parent'] as const) {
  test(`${ownership} selectable nodes do not receive the Site selection exemption`, () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      nodeRegistry._reset()
      registerNode({
        kind: 'wall',
        schemaVersion: 1,
        schema: WallNode,
        category: 'structure',
        defaults: () => {
          const {
            id: _id,
            type: _type,
            ...defaults
          } = WallNode.parse({
            start: [0, 0],
            end: [2, 0],
          })
          return defaults
        },
        capabilities: { selectable: { hitVolume: 'mesh' } },
      })
      const site = SiteNode.parse({})
      const building = BuildingNode.parse({ parentId: site.id })
      const activeLevel = LevelNode.parse({ parentId: building.id, level: 0 })
      const otherLevel = LevelNode.parse({ parentId: building.id, level: 1 })
      const parents = {
        'other-level': otherLevel.id,
        orphan: null,
        'missing-parent': 'site_missing',
      }
      const node = WallNode.parse({
        parentId: parents[ownership],
        start: [0, 0],
        end: [2, 0],
      })
      const nodes = Object.fromEntries(
        [site, building, activeLevel, otherLevel, node].map((entry) => [entry.id, entry]),
      )
      expect(isSelectableSiteNode(node, nodes)).toBe(false)
    } finally {
      restoreRegistry()
    }
  })
}
