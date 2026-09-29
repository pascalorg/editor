import { describe, expect, test } from 'bun:test'
import { SlabNode } from '@pascal-app/core'
import { createSlabDependencyTracker } from './dependency-tracker'

describe('createSlabDependencyTracker', () => {
  test('ignores an incomplete building transform instead of crashing', () => {
    const slab = SlabNode.parse({
      parentId: 'level',
      elevation: 0,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const nodes = {
      building: { id: 'building', type: 'building', children: ['level'] },
      level: { id: 'level', type: 'level', parentId: 'building', children: [slab.id] },
      [slab.id]: slab,
    } as never

    expect(() => createSlabDependencyTracker(nodes)).not.toThrow()
  })
})

for (const [field, value] of [
  ['floorStepFinish', 'library:preset-white'],
  ['floorEdgeFinish', 'library:preset-white'],
  ['floorStepOverrides', [{ key: 'door_1', finish: 'library:preset-white' }]],
] as const)
  test(`${field} changes invalidate the room plate without changing floor intent`, async () => {
    const { LevelNode, ZoneNode } = await import('@pascal-app/core')
    const zone = ZoneNode.parse({
      id: 'zone_paint',
      name: 'Room',
      parentId: 'level_paint',
      spaceRole: 'room',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const slab = SlabNode.parse({
      id: 'slab_paint',
      parentId: 'level_paint',
      boundary: 'auto',
      plateRole: 'platform',
      zoneIds: [zone.id],
      polygon: zone.polygon,
      elevation: 0.55,
      thickness: 0.5,
    })
    const level = LevelNode.parse({ id: 'level_paint', children: [zone.id, slab.id] })
    const nodes = Object.fromEntries([zone, slab, level].map((node) => [node.id, node]))
    const update = createSlabDependencyTracker(nodes)
    expect(update({ ...nodes, [zone.id]: { ...zone, [field]: value } })).toEqual([slab.id])
  })
