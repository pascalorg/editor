import { describe, expect, test } from 'bun:test'
import { migrateVerticalSceneNodes } from './vertical-scene-migration'

type RawNode = Record<string, unknown>

function baseNode(id: string, type: string, parentId: string | null, extra: RawNode = {}): RawNode {
  return { object: 'node', id, type, parentId, visible: true, metadata: {}, ...extra }
}

/**
 * A canonical (already-migrated) flat scene: level carries `height`, slab
 * carries `thickness` — so only the ground-pin heal can report a change.
 */
function flatScene(wallExtra: RawNode, slabExtra: RawNode | null, siteExtra: RawNode = {}) {
  const nodes: Record<string, RawNode> = {
    site_a: baseNode('site_a', 'site', null, { children: ['building_a'], ...siteExtra }),
    building_a: baseNode('building_a', 'building', 'site_a', {
      children: ['level_a'],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }),
    level_a: baseNode('level_a', 'level', 'building_a', {
      level: 0,
      height: 3,
      children: ['wall_a', ...(slabExtra ? ['slab_a'] : [])],
    }),
    wall_a: baseNode('wall_a', 'wall', 'level_a', {
      start: [0, 0],
      end: [4, 0],
      children: [],
      ...wallExtra,
    }),
  }
  if (slabExtra) {
    nodes.slab_a = baseNode('slab_a', 'slab', 'level_a', {
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 1],
        [-1, 1],
      ],
      holes: [],
      ...slabExtra,
    })
  }
  return nodes
}

describe('ground-pin heal', () => {
  test('strips a ground pin (and draft offset) from a wall buried in a floor slab', () => {
    const result = migrateVerticalSceneNodes(
      flatScene(
        { height: 3, supportSlabId: 'ground', supportOffset: 0.0000005 },
        { elevation: 0.15, thickness: 0.15 },
      ),
    )
    expect(result.changed).toBe(true)
    const wall = result.nodes.wall_a as RawNode
    expect('supportSlabId' in wall).toBe(false)
    expect('supportOffset' in wall).toBe(false)
    expect(wall.height).toBe(3)
  })

  test('keeps the pin when the elected slab is a deck hovering above the base', () => {
    const result = migrateVerticalSceneNodes(
      flatScene({ height: 3, supportSlabId: 'ground' }, { elevation: 2.2, thickness: 0.15 }),
    )
    expect(result.changed).toBe(false)
    expect((result.nodes.wall_a as RawNode).supportSlabId).toBe('ground')
  })

  test('keeps the pin when no slab supports the wall', () => {
    const result = migrateVerticalSceneNodes(
      flatScene({ height: 3, supportSlabId: 'ground' }, null),
    )
    expect(result.changed).toBe(false)
    expect((result.nodes.wall_a as RawNode).supportSlabId).toBe('ground')
  })

  test('keeps the pin when the site carries sculpted terrain', () => {
    const result = migrateVerticalSceneNodes(
      flatScene(
        { height: 3, supportSlabId: 'ground' },
        { elevation: 0.15, thickness: 0.15 },
        { terrain: { encoded: 'opaque' } },
      ),
    )
    expect(result.changed).toBe(false)
    expect((result.nodes.wall_a as RawNode).supportSlabId).toBe('ground')
  })

  test('is idempotent', () => {
    const first = migrateVerticalSceneNodes(
      flatScene({ height: 3, supportSlabId: 'ground' }, { elevation: 0.15, thickness: 0.15 }),
    )
    expect(first.changed).toBe(true)
    const second = migrateVerticalSceneNodes(first.nodes)
    expect(second.changed).toBe(false)
  })
})
