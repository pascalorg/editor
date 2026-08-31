import { describe, expect, test } from 'bun:test'
import { SlabNode, WallNode, ZoneNode } from '@pascal-app/core'
import { resolveSmartMeasurementSurfaceHit } from './smart-surface'
import type { LocalSurfaceHit } from './surface-query'

const zone = ZoneNode.parse({
  id: 'zone_room',
  name: 'Room',
  parentId: 'level_main',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
})
const slab = SlabNode.parse({
  id: 'slab_floor',
  parentId: 'level_main',
  polygon: zone.polygon,
})
const wall = WallNode.parse({
  end: [4, 0],
  id: 'wall_front',
  parentId: 'level_main',
  start: [0, 0],
})

function surfaceHit(targetNodeId: string, normal: [number, number, number]): LocalSurfaceHit {
  return { normal, point: [2, 0, 1], targetNodeId }
}

describe('smart measurement zone targeting', () => {
  test('resolves a floor hit inside an active-level zone to that zone', () => {
    const hit = resolveSmartMeasurementSurfaceHit(
      surfaceHit(slab.id, [0, 1, 0]),
      { [slab.id]: slab, [zone.id]: zone },
      'level_main',
    )

    expect(hit.targetNodeId).toBe(zone.id)
  })

  test('does not replace a wall hit with its enclosing zone', () => {
    const hit = resolveSmartMeasurementSurfaceHit(
      surfaceHit(wall.id, [0, 0, 1]),
      { [wall.id]: wall, [zone.id]: zone },
      'level_main',
    )

    expect(hit.targetNodeId).toBe(wall.id)
  })

  test('does not target a zone attached to another level', () => {
    const hit = resolveSmartMeasurementSurfaceHit(
      surfaceHit(slab.id, [0, 1, 0]),
      { [slab.id]: slab, [zone.id]: { ...zone, parentId: 'level_other' } },
      'level_main',
    )

    expect(hit.targetNodeId).toBe(slab.id)
  })
})
