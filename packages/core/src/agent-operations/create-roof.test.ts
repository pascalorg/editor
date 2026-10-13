import { describe, expect, test } from 'bun:test'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import { BuildingNode, LevelNode, WallNode } from '../schema'
import { createRoof, grown, type RoofHost, roofHost } from './create-roof'
import type { SceneNodes } from './types'

type Pt = [number, number]

/** A storey whose walls close the polygon `corners`, in the order given. */
function storey(corners: Pt[]): SceneNodes {
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_0',
      start,
      end: corners[(index + 1) % corners.length]!,
    }),
  )
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: 'building_a',
    level: 0,
    height: 2.8,
    children: walls.map((wall) => wall.id),
  })
  const building = BuildingNode.parse({ id: 'building_a', children: [level.id] })
  return Object.fromEntries([building, level, ...walls].map((node) => [node.id, node]))
}

describe('create_roof: a roof outline that stays on the walls', () => {
  // A 30 m long, 0.52 m deep sliver ends in a 1° point; mitred, the point reached 11 m past the
  // wall and the roof segment came out 41.6 m long (0.2° made it 87 m).
  test('a sharp corner does not stretch the roof past the building', () => {
    const outcome = createRoof(
      storey([
        [0, 0],
        [30, 0],
        [0, 0.52],
      ]),
      {},
      { activeLevelId: null },
    )
    const segments = (outcome.changes?.create ?? [])
      .map(({ node }) => node)
      .filter((node) => node.type === 'roof-segment')

    expect(segments).toHaveLength(1)
    const { width, depth } = segments[0] as unknown as { width: number; depth: number }
    expect(Math.max(width, depth)).toBeLessThan(30.5)
    expect(Math.max(width, depth)).toBeGreaterThan(30)
  })
})

describe('create_roof: the level above the covered storey', () => {
  const house = (above: ReturnType<typeof LevelNode.parse>[]) => {
    const nodes = storey([
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ])
    const building = nodes.building_a as ReturnType<typeof BuildingNode.parse>
    return {
      ...nodes,
      building_a: { ...building, children: [...building.children, ...above.map((l) => l.id)] },
      ...Object.fromEntries(above.map((level) => [level.id, level])),
    } as SceneNodes
  }
  const created = (outcome: ReturnType<typeof createRoof>) =>
    (outcome.changes?.create ?? []).map(({ node }) => node)

  // add_level always leaves a new storey empty: a person or an agent is about to build on it.
  test('a storey added and not built yet is not the roof level: the roof goes above it', () => {
    const empty = LevelNode.parse({
      id: 'level_added',
      parentId: 'building_a',
      level: 1,
      height: 2.8,
    })
    const outcome = createRoof(house([empty]), {}, { activeLevelId: null })

    const [roofLevel] = created(outcome).filter((node) => node.type === 'level')
    expect(roofLevel).toMatchObject({
      type: 'level',
      level: 2,
      parentId: 'building_a',
      metadata: { role: 'roof' },
    })
    const roof = created(outcome).find((node) => node.type === 'roof')
    expect(roof?.parentId).toBe(roofLevel?.id)
    expect(roof?.parentId).not.toBe(empty.id)
  })

  test('a roof level already above the storey is the roof level', () => {
    const roofLevel = LevelNode.parse({
      id: 'level_roof',
      parentId: 'building_a',
      level: 1,
      metadata: { role: 'roof' },
    })
    const outcome = createRoof(house([roofLevel]), {}, { activeLevelId: null })

    expect(created(outcome).filter((node) => node.type === 'level')).toHaveLength(0)
    expect(created(outcome).find((node) => node.type === 'roof')?.parentId).toBe('level_roof')
  })

  // A roof level between the storey and a built storey above is not the top of the building: the
  // walk looks past it, so the roof is not parented under that upper storey.
  test('a storey with rooms above a roof level is a storey above the covered one', () => {
    const roofLevel = LevelNode.parse({
      id: 'level_roof',
      parentId: 'building_a',
      level: 1,
      metadata: { role: 'roof' },
    })
    const upperWall = WallNode.parse({
      id: 'wall_upper',
      parentId: 'level_upper',
      start: [0, 0],
      end: [8, 0],
    })
    const upper = LevelNode.parse({
      id: 'level_upper',
      parentId: 'building_a',
      level: 2,
      children: [upperWall.id],
    })
    const nodes = { ...house([roofLevel, upper]), [upperWall.id]: upperWall } as SceneNodes

    let refusal: AgentRefusal | undefined
    try {
      createRoof(nodes, {}, { activeLevelId: null })
    } catch (error) {
      if (isAgentRefusal(error)) refusal = error
      else throw error
    }

    expect(refusal?.code).toBe('storey_above')
    expect(refusal?.details).toMatchObject({ levelId: 'level_0', storeyAboveId: 'level_upper' })
  })

  test('a storey not built yet above a roof level is a floor to be built: the roof goes above it', () => {
    const roofLevel = LevelNode.parse({
      id: 'level_roof',
      parentId: 'building_a',
      level: 1,
      metadata: { role: 'roof' },
    })
    const empty = LevelNode.parse({ id: 'level_added', parentId: 'building_a', level: 2 })
    const outcome = createRoof(house([roofLevel, empty]), {}, { activeLevelId: null })

    const [roofLevelCreated] = created(outcome).filter((node) => node.type === 'level')
    expect(roofLevelCreated).toMatchObject({ level: 3, metadata: { role: 'roof' } })
    expect(created(outcome).find((node) => node.type === 'roof')?.parentId).toBe(
      roofLevelCreated?.id,
    )
  })
})

// The host rule is one function and a table: each row is a house of one storey (level 0, 8 × 6 m)
// with the levels listed above it, and what the roof is to stand on.
describe('roofHost: the level a roof stands on', () => {
  type Spec = {
    id: string
    level: number
    role?: 'roof' | 'support'
    rooms?: boolean
    building?: string
  }
  const level = (spec: Spec) =>
    LevelNode.parse({
      id: spec.id,
      parentId: spec.building ?? 'building_a',
      level: spec.level,
      ...(spec.role ? { metadata: { role: spec.role } } : {}),
      ...(spec.rooms ? { children: [`wall_on_${spec.id}`] } : {}),
    })
  const scene = (above: Spec[]) => {
    const base = storey([
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ])
    const levels = above.map(level)
    const walls = above
      .filter((spec) => spec.rooms)
      .map((spec) =>
        WallNode.parse({
          id: `wall_on_${spec.id}`,
          parentId: spec.id,
          start: [0, 0],
          end: [8, 0],
        }),
      )
    const building = base.building_a as ReturnType<typeof BuildingNode.parse>
    return {
      ...base,
      building_a: {
        ...building,
        children: [
          ...building.children,
          ...levels.filter((l) => l.parentId === 'building_a').map((l) => l.id),
        ],
      },
      ...Object.fromEntries([...levels, ...walls].map((node) => [node.id, node])),
    } as SceneNodes
  }
  const hostOf = (above: Spec[]): RoofHost =>
    roofHost(scene(above), scene(above).level_0 as Parameters<typeof roofHost>[1])

  const rows: { name: string; above: Spec[]; host: Record<string, unknown> }[] = [
    {
      name: 'no level above: a roof level is built above the storey',
      above: [],
      host: { kind: 'create', above: { id: 'level_0' } },
    },
    {
      name: 'a roof level above: it is the host',
      above: [{ id: 'level_roof', level: 1, role: 'roof' }],
      host: { kind: 'reuse', level: { id: 'level_roof' } },
    },
    {
      name: 'two roof levels above: the lowest is the host',
      above: [
        { id: 'level_roof', level: 1, role: 'roof' },
        { id: 'level_roof_2', level: 2, role: 'roof' },
      ],
      host: { kind: 'reuse', level: { id: 'level_roof' } },
    },
    {
      name: 'a support level above, with nothing on it: not the host, the roof goes above it',
      above: [{ id: 'level_support', level: 1, role: 'support' }],
      host: { kind: 'create', above: { id: 'level_support' } },
    },
    {
      name: 'a support level above, with things on it: not the host either',
      above: [{ id: 'level_support', level: 1, role: 'support', rooms: true }],
      host: { kind: 'create', above: { id: 'level_support' } },
    },
    {
      name: 'an empty occupied storey above: a floor to be built, the roof goes above it',
      above: [{ id: 'level_added', level: 1 }],
      host: { kind: 'create', above: { id: 'level_added' } },
    },
    {
      name: 'several empty storeys and a support level stacked: the roof goes above the highest',
      above: [
        { id: 'level_added', level: 1 },
        { id: 'level_added_2', level: 2 },
        { id: 'level_support', level: 3, role: 'support' },
      ],
      host: { kind: 'create', above: { id: 'level_support' } },
    },
    {
      name: 'a roof level above several floors to be built is the host',
      above: [
        { id: 'level_added', level: 1 },
        { id: 'level_support', level: 2, role: 'support' },
        { id: 'level_roof', level: 3, role: 'roof' },
      ],
      host: { kind: 'reuse', level: { id: 'level_roof' } },
    },
    {
      name: 'a roof level below a floor to be built is not above it: a new roof level goes above',
      above: [
        { id: 'level_roof', level: 1, role: 'roof' },
        { id: 'level_added', level: 2 },
      ],
      host: { kind: 'create', above: { id: 'level_added' } },
    },
    {
      name: 'a storey with rooms above: refused, naming it',
      above: [{ id: 'level_upper', level: 1, rooms: true }],
      host: { kind: 'refuse', code: 'storey_above', storeyAbove: { id: 'level_upper' } },
    },
    {
      name: 'a storey with rooms above a roof level: refused, the roof level does not hide it',
      above: [
        { id: 'level_roof', level: 1, role: 'roof' },
        { id: 'level_upper', level: 2, rooms: true },
      ],
      host: { kind: 'refuse', code: 'storey_above', storeyAbove: { id: 'level_upper' } },
    },
    {
      name: 'a roof level of another building is not reused',
      above: [{ id: 'level_other_roof', level: 1, role: 'roof', building: 'building_b' }],
      host: { kind: 'create', above: { id: 'level_0' } },
    },
  ]

  for (const row of rows)
    test(row.name, () => {
      expect(hostOf(row.above)).toMatchObject(row.host)
    })

  test('a storey with no building: refused, there is no roof level to build', () => {
    const base = storey([
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ])
    const orphan = { ...base.level_0, parentId: undefined } as unknown as Parameters<
      typeof roofHost
    >[1]
    const nodes = { ...base, level_0: orphan } as SceneNodes

    expect(roofHost(nodes, orphan)).toEqual({ kind: 'refuse', code: 'storey_without_building' })
    expect(() => createRoof(nodes, {}, { activeLevelId: null })).toThrow(/not in a building/)
  })

  test('over a support level the roof stands on a roof level built above it, not on the support', () => {
    const outcome = createRoof(
      scene([{ id: 'level_support', level: 1, role: 'support' }]),
      {},
      { activeLevelId: null },
    )
    const created = (outcome.changes?.create ?? []).map(({ node }) => node)
    const [roofLevel] = created.filter((node) => node.type === 'level')

    expect(roofLevel).toMatchObject({
      level: 2,
      parentId: 'building_a',
      metadata: { role: 'roof' },
    })
    expect(created.find((node) => node.type === 'roof')?.parentId).toBe(roofLevel?.id)
  })
})

describe('create_roof: a finish the library lacks', () => {
  const house = () =>
    storey([
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ])
  const context = { activeLevelId: null }

  function refusalOf(run: () => unknown) {
    try {
      run()
    } catch (error) {
      expect(isAgentRefusal(error)).toBe(true)
      return error as AgentRefusal
    }
    throw new Error('create_roof did not refuse')
  }

  test('a fascia finish is refused as the roof finish is, and nothing is created', () => {
    const refusal = refusalOf(() =>
      createRoof(
        house(),
        { fasciaHeight: 0.3, fasciaMaterialPreset: 'library:no-such-fascia' },
        context,
      ),
    )

    expect(refusal.code).toBe('unknown_material')
    expect(refusal.message).toContain('fasciaMaterialPreset')
    expect(refusal.message).toContain('library:no-such-fascia')
  })

  test('a library finish is written on every segment of the band', () => {
    const outcome = createRoof(
      house(),
      { fasciaHeight: 0.3, fasciaMaterialPreset: 'library:preset-nearblack' },
      context,
    )
    const segments = (outcome.changes?.create ?? [])
      .map(({ node }) => node)
      .filter((node) => node.type === 'roof-segment')

    expect(segments.length).toBeGreaterThan(0)
    for (const segment of segments)
      expect(segment).toMatchObject({
        fascia: true,
        fasciaHeight: 0.3,
        fasciaMaterialPreset: 'library:preset-nearblack',
      })
  })
})

describe('the outline grown to the walls’ outer faces', () => {
  const finite = (points: Pt[]) => points.every((point) => point.every(Number.isFinite))

  test('mitres a right angle exactly', () => {
    const square: Pt[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const out = grown(square, 0.1)

    expect(out).toHaveLength(4)
    const expected: Pt[] = [
      [-0.1, -0.1],
      [4.1, -0.1],
      [4.1, 4.1],
      [-0.1, 4.1],
    ]
    for (const [i, [x, z]] of expected.entries()) {
      expect(out[i]![0]).toBeCloseTo(x, 9)
      expect(out[i]![1]).toBeCloseTo(z, 9)
    }
  })

  test('keeps a point of 0.2° within a wall’s width of its corner', () => {
    const sliver: Pt[] = [
      [0, 0],
      [30, 0],
      [0, 0.105],
    ]
    const out = grown(sliver, 0.1)

    expect(finite(out)).toBe(true)
    for (const [x, z] of out) {
      expect(x).toBeGreaterThan(-0.5)
      expect(x).toBeLessThan(30.5)
      expect(Math.abs(z)).toBeLessThan(0.5)
    }
  })

  test('gives finite points where an edge folds back exactly on itself', () => {
    const out = grown(
      [
        [0, 0],
        [10, 0],
        [5, 0],
      ],
      0.1,
    )

    expect(finite(out)).toBe(true)
  })
})
