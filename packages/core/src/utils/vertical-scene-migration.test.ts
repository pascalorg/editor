import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { resolveWallTop } from '../systems/wall/wall-top'
import { healSceneNodes, normalizeLegacyStructure } from './scene-migrations'
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

// Scenes saved before levels stored a height, from the plate corpus.
const PLATE_CORPUS = new URL('../lib/__fixtures__/plate-corpus/', import.meta.url)
const legacyCorpus = ['legacy-load', 'frozen-gate', 'review', 'migrations']
  .flatMap((folder) =>
    readdirSync(new URL(`${folder}/`, PLATE_CORPUS))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => {
        const fixture = JSON.parse(readFileSync(new URL(`${folder}/${file}`, PLATE_CORPUS), 'utf8'))
        const stored = (fixture.nodes ?? fixture) as Record<string, unknown>
        return {
          scene: `${folder}/${file}`,
          nodes: healSceneNodes(normalizeLegacyStructure(stored)).nodes,
        }
      }),
  )
  .filter(({ nodes }) =>
    Object.values(nodes).some(
      (node) => (node as RawNode).type === 'level' && !('height' in (node as RawNode)),
    ),
  )

type LegacyNode = Record<string, any>

/**
 * How the editor drew a level before levels stored a height: a wall stood on
 * its slab when the slab was above the floor and rose by its height, 2.5 m
 * when none was stored; the storey was as tall as its tallest wall top or
 * ceiling (2.5 m when the ceiling stored none).
 */
function legacyStorey(levelId: string, nodes: Record<string, LegacyNode>) {
  const children = ((nodes[levelId]!.children ?? []) as string[])
    .map((id) => nodes[id])
    .filter((child): child is LegacyNode => child !== undefined)
  const slabs = children.filter((child) => child.type === 'slab')
  const walls = children.filter((child) => child.type === 'wall')
  const wallTops = new Map<string, number>()
  for (const wall of walls) {
    const base = computeWallSlabSupport(wall as never, slabs as never, walls as never).elevation
    wallTops.set(wall.id, Math.max(0, base) + (wall.height ?? 2.5))
  }
  const ceilings = children.filter((child) => child.type === 'ceiling').map((c) => c.height ?? 2.5)
  const tallest = Math.max(0, ...wallTops.values(), ...ceilings)
  return { height: tallest > 0 ? tallest : 2.5, wallTops }
}

describe('legacy corpus loads as the editor drew it', () => {
  test('the corpus holds scenes saved before levels stored a height', () => {
    expect(legacyCorpus.length).toBeGreaterThan(0)
  })

  test.each(legacyCorpus)('$scene: storeys keep their height and no wall rises above its storey', ({
    nodes,
  }) => {
    const migrated = migrateVerticalSceneNodes(nodes).nodes as Record<string, LegacyNode>
    for (const [levelId, level] of Object.entries(nodes as Record<string, LegacyNode>)) {
      if (level?.type !== 'level' || 'height' in level) continue
      const before = legacyStorey(levelId, nodes as Record<string, LegacyNode>)
      const plane = migrated[levelId]!.height as number
      const rounded = (value: number) => Math.round(value * 1e6) / 1e6
      expect({ levelId, height: rounded(plane) }).toEqual({
        levelId,
        height: rounded(before.height),
      })
      const slabs = (migrated[levelId]!.children as string[])
        .map((id) => migrated[id])
        .filter((child): child is LegacyNode => child?.type === 'slab')
      const walls = (migrated[levelId]!.children as string[])
        .map((id) => migrated[id])
        .filter((child): child is LegacyNode => child?.type === 'wall')
      for (const wall of walls) {
        const base = computeWallSlabSupport(wall as never, slabs as never, walls as never).elevation
        const top = resolveWallTop(wall as never, plane, base)
        // Never above the storey it belongs to (it would cut the floor or
        // roof above), and moved only by the snap onto the storey plane.
        expect(top).toBeLessThanOrEqual(plane + 1e-9)
        expect(Math.abs(top - before.wallTops.get(wall.id)!)).toBeLessThan(0.2)
      }
    }
  })
})
