import { expect, test } from 'bun:test'
import { SlabNode } from '@pascal-app/core'
import { resolvePaintScopeTargets } from './paint-scope'

test('hovering one owner-room step previews its role across all plates on the level', () => {
  const base = SlabNode.parse({
    id: 'slab_base',
    parentId: 'level_one',
    boundary: 'auto',
    plateRole: 'base',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const platform = SlabNode.parse({ ...base, id: 'slab_platform', plateRole: 'platform' })
  const upper = SlabNode.parse({ ...base, id: 'slab_upper', parentId: 'level_two' })
  const targets = resolvePaintScopeTargets({
    node: base,
    role: 'step:zone_upper',
    scope: 'single',
    nodes: { [base.id]: base, [platform.id]: platform, [upper.id]: upper },
    spaces: {},
    slotRolesOf: () => [],
  })
  expect(targets).toEqual([
    { nodeId: base.id, role: 'step:zone_upper' },
    { nodeId: platform.id, role: 'step:zone_upper' },
  ])
})
