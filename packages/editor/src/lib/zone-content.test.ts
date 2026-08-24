import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import { collectZoneContentIds, collectZoneObjectIds } from './zone-content'

/**
 * A 10x10 zone with its corner at the origin, on level `level_1`.
 */
const zone = {
  id: 'zone_a',
  type: 'zone',
  parentId: 'level_1',
  polygon: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
} as unknown as ZoneNode

function positioned(id: string, type: string, x: number, z: number, parentId = 'level_1') {
  return { id, type, parentId, position: [x, 1, z] } as unknown as AnyNode
}

function sceneOf(...nodes: AnyNode[]): Readonly<Record<AnyNodeId, AnyNode>> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

describe('collectZoneObjectIds', () => {
  /**
   * The defect this function exists for: a zone full of racking reported
   * nothing inside it, because the only positioned kind the delete path knows
   * is `item` and a rack is `warehouse:pallet-rack`.
   */
  test('finds plugin-contributed kinds, not only item nodes', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5),
      positioned('item_1', 'item', 6, 6),
    )

    const found = collectZoneObjectIds(scene, zone)
    expect(found).toContain('rack_1' as AnyNodeId)
    expect(found).toContain('item_1' as AnyNodeId)

    // The delete path sees the item and misses the rack — the discrepancy this
    // function was added to work around rather than silently widen.
    expect(collectZoneContentIds(scene, zone)).not.toContain('rack_1' as AnyNodeId)
  })

  test('excludes objects standing outside the polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('inside', 'warehouse:pallet', 1, 1),
      positioned('outside', 'warehouse:pallet', 40, 40),
    )
    const found = collectZoneObjectIds(scene, zone)
    expect(found).toContain('inside' as AnyNodeId)
    expect(found).not.toContain('outside' as AnyNodeId)
  })

  test('excludes objects on another level', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('here', 'warehouse:pallet', 5, 5),
      positioned('upstairs', 'warehouse:pallet', 5, 5, 'level_2'),
    )
    const found = collectZoneObjectIds(scene, zone)
    expect(found).toEqual(['here' as AnyNodeId])
  })

  /** A zone is not standing inside itself, and neither is its own fabric. */
  test('excludes the zone fabric and other zones', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('other_zone', 'zone', 5, 5),
      positioned('a_wall', 'wall', 5, 5),
      positioned('a_slab', 'slab', 5, 5),
      positioned('a_rack', 'warehouse:pallet-rack', 5, 5),
    )
    expect(collectZoneObjectIds(scene, zone)).toEqual(['a_rack' as AnyNodeId])
  })

  test('a node without a usable position is skipped rather than throwing', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      { id: 'no_pos', type: 'warehouse:pallet', parentId: 'level_1' } as unknown as AnyNode,
      positioned('ok', 'warehouse:pallet', 5, 5),
    )
    expect(collectZoneObjectIds(scene, zone)).toEqual(['ok' as AnyNodeId])
  })
})
