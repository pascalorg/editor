import { describe, expect, test } from 'bun:test'
import { CeilingNode, LevelNode, SlabNode, WallNode } from '../schema'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { migrateVerticalSceneNodes } from '../utils/vertical-scene-migration'
import { getRenderableSlabPolygon } from './slab-polygon'
import { detectSpacesForLevel } from './space-detection'
import { reconcileLevelStructure } from './structure-kernel'
import { reconcileSceneStructure } from './structure-reconcile'

type Tuple = [number, number]

function rectangle(x: number, y: number, width: number, height: number): Tuple[] {
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ]
}

function expectPolygonRotation(actual: Tuple[], expected: Tuple[]) {
  expect(actual).toHaveLength(expected.length)
  const offset = expected.findIndex(
    ([x, y]) => Math.abs(x - actual[0]![0]) < 1e-9 && Math.abs(y - actual[0]![1]) < 1e-9,
  )
  expect(offset).toBeGreaterThanOrEqual(0)
  actual.forEach(([x, y], index) => {
    const point = expected[(index + offset) % expected.length]!
    expect(x).toBeCloseTo(point[0], 9)
    expect(y).toBeCloseTo(point[1], 9)
  })
}

describe('room generator invariants', () => {
  test('I5: an associated authored floor replaces a connected plate, and removal restores it', () => {
    const polygon = rectangle(0, 0, 8, 4)
    const level = LevelNode.parse({ id: 'level_test' })
    const walls = polygon.map((start, i) =>
      WallNode.parse({ id: `wall_${i}`, parentId: level.id, start, end: polygon[(i + 1) % 4] }),
    )
    walls.push(
      WallNode.parse({ id: 'wall_divider', parentId: level.id, start: [2, 0], end: [2, 4] }),
    )
    const manual = SlabNode.parse({ id: 'slab_manual', parentId: level.id, polygon })
    const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
    let id = 0
    const mintId = (kind: string) => `${kind}_${id++}`
    const initial = reconcileSceneStructure({ nodes, mintId }).nodes
    const withOwner = Object.fromEntries(
      Object.entries(initial).map(([id, node]) => [
        id,
        node.type === 'zone'
          ? { ...node, floor: { ...node.floor, sourceSlabId: manual.id } }
          : node,
      ]),
    )
    const covered = reconcileSceneStructure({
      nodes: { ...withOwner, [manual.id]: manual },
      mintId,
    }).nodes
    expect(Object.values(covered).filter((node) => node.type === 'slab')).toEqual([manual])
    const { [manual.id]: _, ...withoutManual } = covered
    const restored = reconcileSceneStructure({ nodes: withoutManual, mintId }).nodes
    expect(Object.values(restored).filter((node) => node.type === 'slab')).toHaveLength(1)
    const distant = { ...manual, polygon: rectangle(20, 20, 8, 4) }
    const unaffected = reconcileSceneStructure({
      nodes: { ...restored, [distant.id]: distant },
      mintId,
    }).nodes
    expect(Object.values(unaffected).filter((node) => node.type === 'slab')).toHaveLength(2)
    expect(unaffected[distant.id]).toBe(distant)
  })

  for (const kind of ['slab', 'ceiling'] as const) {
    test(`I7: ${kind} orphan retirement deletes derived construction and preserves a manual cover`, () => {
      const level = LevelNode.parse({ id: 'level_test' })
      const polygon = rectangle(0, 0, 4, 4)
      const walls = polygon.map((start, index) =>
        WallNode.parse({
          id: `wall_${index}`,
          parentId: level.id,
          start,
          end: polygon[(index + 1) % 4],
        }),
      )
      const schema = kind === 'slab' ? SlabNode : CeilingNode
      const orphan = schema.parse({
        id: `${kind}_orphan`,
        parentId: level.id,
        boundary: 'auto',
        polygon: rectangle(-2, -2, 8, 8),
        autoFromWalls: true,
      })
      const manual = schema.parse({ id: `${kind}_manual`, parentId: level.id, polygon })
      const nodes = Object.fromEntries(
        [level, ...walls, orphan, manual].map((node) => [node.id, node]),
      )
      const result = reconcileLevelStructure({
        levelId: level.id,
        nodes,
        mintId: (kind) => `${kind}_created`,
      })
      expect(
        result.patches.filter((patch) => patch.op === 'create' && patch.node.type === kind),
      ).toEqual([])
      expect(result.patches.filter((patch) => patch.op === 'delete')).toEqual(
        kind === 'slab' ? [] : [{ op: 'delete', id: orphan.id }],
      )
      if (kind === 'slab')
        expect(result.patches).toContainEqual(
          expect.objectContaining({
            op: 'update',
            id: orphan.id,
            data: expect.objectContaining({ plateRole: 'base' }),
          }),
        )
      expect(result.patches.some((patch) => patch.op === 'update' && patch.id === manual.id)).toBe(
        false,
      )
    })
  }

  test('I8: span sides classify exterior, shared and reversed walls; free walls keep previous sides', () => {
    const polygon = rectangle(0, 0, 4, 4)
    const walls = polygon.map((start, i) =>
      WallNode.parse({ id: `wall_outer_${i}`, start, end: polygon[(i + 1) % 4] }),
    )
    const sides = (boundaries: WallNode[], id: string) =>
      detectSpacesForLevel('level_test', boundaries).wallUpdates.find(
        (update) => update.wallId === id,
      )
    expect(sides(walls, walls[0]!.id)).toMatchObject({
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const reversed = { ...walls[0]!, start: walls[0]!.end, end: walls[0]!.start }
    expect(sides([reversed, ...walls.slice(1)], reversed.id)).toMatchObject({
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const divider = WallNode.parse({
      id: 'wall_shared',
      start: [2, 0],
      end: [2, 4],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    expect(sides([...walls, divider], divider.id)).toMatchObject({
      frontSide: 'interior',
      backSide: 'interior',
    })
    expect(sides([divider], divider.id)).toMatchObject({
      frontSide: 'exterior',
      backSide: 'interior',
    })
  })

  test('I10: stored auto plates retain majority support election and stepped base segments', () => {
    const wall = WallNode.parse({ id: 'wall_support', start: [0, 0], end: [10, 0], thickness: 0.2 })
    for (const highWidth of [7, 3]) {
      const high = SlabNode.parse({
        id: 'slab_high',
        boundary: 'auto',
        polygon: rectangle(0, -1, highWidth, 2),
        elevation: 0.6,
        thickness: 0.6,
      })
      const low = SlabNode.parse({
        id: 'slab_low',
        boundary: 'auto',
        polygon: rectangle(highWidth, -1, 10 - highWidth, 2),
        elevation: 0.1,
        thickness: 0.1,
      })
      const support = computeWallSlabSupport(wall, [low, high], [wall])
      expect(support.elevation).toBe(highWidth === 7 ? 0.6 : 0.1)
      expect(support.electedSlabId).toBe(highWidth === 7 ? high.id : low.id)
      expect(support.baseElevation).toBe(0.1)
      expect(support.baseSegments).toHaveLength(2)
      expect(support.baseSegments[0]!.start).toBe(0)
      expect(support.baseSegments[0]!.end).toBeCloseTo(highWidth / 10)
      expect(support.baseSegments[0]!.elevation).toBe(0.6)
      expect(support.baseSegments[1]!.start).toBeCloseTo(highWidth / 10)
      expect(support.baseSegments[1]!.end).toBe(1)
      expect(support.baseSegments[1]!.elevation).toBe(0.1)
      expect(computeWallSlabSupport(wall, [high, low], [wall])).toEqual(support)
    }
  })

  test('I11: generated plates store exterior wall faces and render unchanged', () => {
    const polygon = rectangle(0, 0, 4, 3)
    const walls = polygon.map((start, index) =>
      WallNode.parse({
        id: `wall_centerline_${index}`,
        parentId: 'level_centerline',
        start,
        end: polygon[(index + 1) % 4],
        thickness: 0.2,
      }),
    )
    const level = LevelNode.parse({
      id: 'level_centerline',
      children: walls.map((wall) => wall.id),
    })
    const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
    const result = reconcileSceneStructure({ nodes, mintId: (kind) => `${kind}_test` })
    const slab = Object.values(result.nodes).find((node): node is SlabNode => node.type === 'slab')!
    const rendered = getRenderableSlabPolygon(slab, { walls, siblingSlabs: [] })
    expectPolygonRotation(rendered, [
      [-0.1, -0.1],
      [4.1, -0.1],
      [4.1, 3.1],
      [-0.1, 3.1],
    ])
    expect(rendered).toBe(slab.polygon)
    const deck = SlabNode.parse({
      id: 'slab_floating_deck',
      polygon,
      elevation: 1.5,
      thickness: 0.05,
    })
    expect(deck.elevation - deck.thickness).toBeGreaterThan(0.01)
    expect(getRenderableSlabPolygon(deck, { walls, siblingSlabs: [] })).toEqual(polygon)
  })
})

type RawNode = Record<string, unknown>

function legacyNode(
  id: string,
  type: string,
  parentId: string | null,
  extra: RawNode = {},
): RawNode {
  return { object: 'node', id, type, parentId, visible: true, metadata: {}, ...extra }
}

const square = rectangle(0, 0, 4, 4)
const legacyWall = (id: string, height?: number, start: Tuple = [0, 0], end: Tuple = [4, 0]) =>
  legacyNode(id, 'wall', 'level_a', {
    start,
    end,
    children: [],
    ...(height === undefined ? {} : { height }),
  })
const legacySlab = (id: string, elevation: number | undefined) =>
  legacyNode(id, 'slab', 'level_a', {
    polygon: square,
    holes: [],
    ...(elevation === undefined ? {} : { elevation }),
  })
const legacyCeiling = (height: number, extra: RawNode = {}) =>
  legacyNode('ceiling_a', 'ceiling', 'level_a', { polygon: square, holes: [], height, ...extra })

function legacyScene(children: RawNode[], levelExtra: RawNode = {}) {
  const nodes = [
    legacyNode('site_test', 'site', null, { children: ['building_a'] }),
    legacyNode('building_a', 'building', 'site_test', { children: ['level_a'] }),
    legacyNode('level_a', 'level', 'building_a', {
      level: 0,
      children: children.map((node) => node.id),
      ...levelExtra,
    }),
    ...children,
  ]
  return Object.fromEntries(nodes.map((node) => [String(node.id), node]))
}

describe('I12: vertical migration byte idempotence on legacy migration fixtures', () => {
  // These raw fixtures mirror use-scene-vertical-migration.test.ts; schema parsing would erase legacy absence.
  const fixtures: Array<[string, Record<string, RawNode>]> = [
    [
      'default storey',
      legacyScene([
        legacySlab('slab_a', 0.05),
        legacyWall('wall_a'),
        legacyWall('wall_b', undefined, [4, 0], [4, 4]),
      ]),
    ],
    ['empty level', legacyScene([])],
    [
      'near-plane walls',
      legacyScene([
        legacySlab('slab_a', 0.05),
        legacyWall('wall_tall', 2.65),
        legacyWall('wall_a', undefined, [4, 0], [4, 4]),
        legacyWall('wall_b', undefined, [0, 4], [4, 4]),
      ]),
    ],
    [
      'intentional short walls',
      legacyScene([
        legacyCeiling(2.5),
        legacyWall('wall_a', 2.3),
        legacyWall('wall_b', 2.1, [4, 0], [4, 4]),
      ]),
    ],
    ['absent short wall', legacyScene([legacyCeiling(3), legacyWall('wall_a')])],
    ['near-bound ceiling', legacyScene([legacyCeiling(2.5)])],
    ['clamped ceiling', legacyScene([legacyCeiling(2.49)])],
    ['intentional low ceiling', legacyScene([legacyWall('wall_tall', 3), legacyCeiling(2)])],
    [
      'auto ceiling',
      legacyScene([legacyWall('wall_tall', 3), legacyCeiling(2.2, { autoFromWalls: true })]),
    ],
    [
      'legacy stairs',
      legacyScene([
        legacyNode('stair_a', 'stair', 'level_a', {
          position: [1, 0, 1],
          children: [],
          totalRise: 2.5,
        }),
        legacyNode('stair_b', 'stair', 'level_a', {
          position: [1, 0, 1],
          children: [],
          totalRise: 3.1,
        }),
      ]),
    ],
    ['raised and zero slabs', legacyScene([legacySlab('slab_a', 0.3), legacySlab('slab_b', 0)])],
    ['absent slab elevation', legacyScene([legacySlab('slab_a', undefined)])],
    ['legacy pool', legacyScene([legacySlab('slab_a', -0.15)])],
    [
      'already-split below-plane solid',
      legacyScene([{ ...legacySlab('slab_a', -0.15), thickness: 0.3 }]),
    ],
  ]
  const mixed = legacyScene(
    [
      legacySlab('slab_a', 0.05),
      legacyWall('wall_tall', 2.65),
      legacyWall('wall_a', undefined, [4, 0], [4, 4]),
      legacyNode('stair_a', 'stair', 'level_a', {
        position: [1, 0, 1],
        children: [],
        totalRise: 2.5,
      }),
      legacyNode('stair_b', 'stair', 'level_a', {
        position: [1, 0, 1],
        children: [],
        totalRise: 3.1,
      }),
    ],
    { level: 2.5 },
  )
  mixed.building_a!.children = ['level_a', 'level_b']
  mixed.level_b = legacyNode('level_b', 'level', 'building_a', {
    level: 5,
    children: ['ceiling_b', 'wall_b'],
  })
  mixed.ceiling_b = { ...legacyCeiling(3), id: 'ceiling_b', parentId: 'level_b' }
  mixed.wall_b = { ...legacyWall('wall_b'), parentId: 'level_b' }
  fixtures.push(['mixed idempotence fixture', mixed])

  const ordinals: Record<string, RawNode> = {
    site_test: legacyNode('site_test', 'site', null, { children: ['building_a', 'building_b'] }),
  }
  for (const [building, levels] of [
    ['a', [2.5, 2.5, 5]],
    ['b', [-3, -1, 0, 4]],
  ] as const) {
    const children = levels.map((_, index) => `level_${building}${index + 1}`)
    ordinals[`building_${building}`] = legacyNode(`building_${building}`, 'building', 'site_test', {
      children,
    })
    levels.forEach((level, index) => {
      const id = children[index]!
      ordinals[id] = legacyNode(id, 'level', `building_${building}`, { level, children: [] })
    })
  }
  fixtures.push(['per-building fractional and basement ordinals', ordinals])

  test.each(fixtures)('I12: %s', (_, fixture) => {
    const original = JSON.stringify(fixture)
    const first = migrateVerticalSceneNodes(fixture)
    expect(first.changed).toBe(true)
    const bytes = JSON.stringify(first.nodes)
    const second = migrateVerticalSceneNodes(JSON.parse(bytes))
    expect(second.changed).toBe(false)
    expect(JSON.stringify(second.nodes)).toBe(bytes)
    expect(JSON.stringify(first.nodes)).toBe(bytes)
    expect(JSON.stringify(fixture)).toBe(original)
  })
})
