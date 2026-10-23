import { beforeEach, expect, it } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  BuildingNode,
  DEFAULT_LEVEL_HEIGHT,
  GROUND_SUPPORT_ID,
  getFloorPlacedElevation,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveStairTotalRise,
  SlabNode,
  StairNode,
  StairSegmentNode,
  spatialGridManager,
  syncStairRises,
} from '../../index'

type SceneOptions = {
  levelHeight?: number
  totalRise?: number
  deckElevation?: number
  staleDeck?: boolean
  floorElevation?: number
  groundHost?: boolean
  segments?: Array<{ segmentType?: 'stair' | 'landing'; height: number }>
}

beforeEach(() => {
  nodeRegistry._reset()
  spatialGridManager.clear()
  registerNode({
    kind: 'stair',
    schemaVersion: 1,
    schema: StairNode,
    category: 'structure',
    defaults: () => StairNode.parse({}),
    capabilities: {
      floorPlaced: {
        footprints: (node) => [
          { position: node.position, dimensions: [1, 1, 2], rotation: [0, 0, 0] },
        ],
      },
    },
  } as AnyNodeDefinition)
})

function buildScene(options: SceneOptions = {}) {
  const level = LevelNode.parse({ level: 0, height: options.levelHeight })
  const deck = SlabNode.parse({
    parentId: level.id,
    polygon: [
      [8, 8],
      [10, 8],
      [10, 10],
      [8, 10],
    ],
    elevation: options.deckElevation,
  })
  const floor = SlabNode.parse({
    parentId: level.id,
    polygon: [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ],
    elevation: options.floorElevation,
  })
  const segments = (options.segments ?? []).map((segment) => StairSegmentNode.parse(segment))
  const stair = StairNode.parse({
    parentId: level.id,
    totalRise: options.totalRise,
    deckSlabId: options.staleDeck
      ? 'slab_gone'
      : options.deckElevation !== undefined
        ? deck.id
        : undefined,
    supportSlabId: options.groundHost ? GROUND_SUPPORT_ID : undefined,
    children: segments.map((segment) => segment.id),
  })
  for (const segment of segments) segment.parentId = stair.id
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, stair, ...segments].map((node) => [node.id, node]),
  )
  for (const [slab, enabled] of [
    [deck, options.deckElevation !== undefined],
    [floor, options.floorElevation !== undefined],
  ] as const) {
    if (!enabled) continue
    nodes[slab.id] = slab
    spatialGridManager.handleNodeCreated(slab, level.id)
  }
  level.children = [
    stair.id,
    ...Object.values(nodes)
      .filter((node) => node.type === 'slab')
      .map((node) => node.id),
  ]
  return { level, stair, deck, floor, segments, nodes }
}

const riseCases: Array<[string, SceneOptions, number]> = [
  ['level height', { levelHeight: 3.2 }, 3.2],
  ['explicit rise over level', { levelHeight: 3.2, totalRise: 2.5 }, 2.5],
  ['deck elevation', { deckElevation: 1.25 }, 1.25],
  ['explicit rise over deck', { deckElevation: 1.25, totalRise: 2 }, 2],
  ['stale deck falls back to level', { deckElevation: 1.25, staleDeck: true }, 2.5],
  ['lifted deck base', { deckElevation: 1.25, floorElevation: 0.05 }, 1.2],
  ['lifted level base', { levelHeight: 5.3, floorElevation: 0.05 }, 5.25],
  ['ground under tall level', { levelHeight: 5.3 }, 5.3],
  [
    'explicit rise over lifted deck',
    { deckElevation: 1.25, floorElevation: 0.05, totalRise: 2 },
    2,
  ],
  [
    'explicit rise over lifted level',
    { levelHeight: 5.3, floorElevation: 0.05, totalRise: 2.7 },
    2.7,
  ],
  ['persisted ground host', { deckElevation: 1.25, floorElevation: 0.05, groundHost: true }, 1.25],
]
for (const [name, options, expected] of riseCases)
  it(`resolves ${name}`, () => {
    const { stair, nodes } = buildScene(options)
    expect(resolveStairTotalRise(stair, nodes)).toBeCloseTo(expected)
  })

it('falls back to the level default when the containing level is absent', () => {
  const { stair } = buildScene()
  expect(resolveStairTotalRise(stair, {})).toBe(DEFAULT_LEVEL_HEIGHT)
})

it('includes signed destination-level offsets without changing the stair', () => {
  const { level, stair, nodes } = buildScene({ levelHeight: 2.5 })
  const building = BuildingNode.parse({})
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  for (const baseElevation of [0.4, -0.4]) {
    const stacked = {
      ...nodes,
      [building.id]: building,
      [level.id]: { ...level, parentId: building.id },
      [upper.id]: { ...upper, baseElevation },
    }
    expect(resolveStairTotalRise(stair, stacked)).toBeCloseTo(level.height! + baseElevation)
  }
})

const syncCases: Array<[string, SceneOptions, number | null]> = [
  ['deck flight', { deckElevation: 1.6 }, 1.6],
  ['matching deck flight', { deckElevation: 1.25 }, null],
  ['explicit deck rise', { deckElevation: 1.25, totalRise: 2 }, 2],
  ['stale deck fallback', { deckElevation: 1.6, staleDeck: true }, 2.5],
  ['stale deck with authored rise', { deckElevation: 1.6, staleDeck: true, totalRise: 2 }, null],
  ['following level', { levelHeight: 2.5 }, 2.5],
  ['lifted deck', { deckElevation: 1.25, floorElevation: 0.05 }, 1.2],
  ['lifted level', { levelHeight: 5.3, floorElevation: 0.05 }, 5.25],
]
for (const [name, options, target] of syncCases)
  it(`synchronizes ${name} without altering the authored destination`, () => {
    const { stair, segments, nodes } = buildScene({ ...options, segments: [{ height: 1.25 }] })
    const updates = syncStairRises(nodes)
    if (target === null) expect(updates).toEqual([])
    else expect(updates).toEqual([{ id: segments[0]!.id, data: { height: target } }])
    expect(nodes[stair.id]).toBe(stair)
  })

for (const destination of ['level', 'deck'] as const)
  for (const floorElevation of [undefined, 0.05])
    it(`rescales ${destination} flights proportionally from ${floorElevation ?? 0}, preserving landings`, () => {
      const { segments, nodes } = buildScene({
        ...(destination === 'deck' ? { deckElevation: 2.1 } : { levelHeight: 2.1 }),
        floorElevation,
        segments: [{ height: 0.5 }, { segmentType: 'landing', height: 0.1 }, { height: 0.5 }],
      })
      const updated = new Map(syncStairRises(nodes).map((patch) => [patch.id, patch.data.height]))
      expect(updated.get(segments[0]!.id)).toBeCloseTo((2 - (floorElevation ?? 0)) / 2)
      expect(updated.get(segments[2]!.id)).toBeCloseTo(updated.get(segments[0]!.id)!)
      expect(updated.has(segments[1]!.id)).toBe(false)
    })

for (const destination of ['level', 'deck'] as const)
  for (const change of ['destination', 'base'] as const)
    it(`tracks ${destination} ${change} elevation changes without a stair write`, () => {
      const scene = buildScene({
        ...(destination === 'deck' ? { deckElevation: 1.25 } : { levelHeight: 2.5 }),
        floorElevation: 0.05,
        segments: [{ height: destination === 'deck' ? 1.2 : 2.45 }],
      })
      expect(syncStairRises(scene.nodes)).toEqual([])
      const edited =
        change === 'base'
          ? { ...scene.floor, elevation: 0.3 }
          : destination === 'deck'
            ? { ...scene.deck, elevation: 1.6 }
            : { ...scene.level, height: 3 }
      const nodes = { ...scene.nodes, [edited.id]: edited }
      if (edited.type === 'slab') spatialGridManager.handleNodeUpdated(edited, scene.level.id)
      const target =
        change === 'base'
          ? (destination === 'deck' ? 1.25 : 2.5) - 0.3
          : (destination === 'deck' ? 1.6 : 3) - 0.05
      expect(resolveStairTotalRise(scene.stair, nodes)).toBeCloseTo(target)
      expect(
        syncStairRises(nodes).find((patch) => patch.id === scene.segments[0]!.id)?.data.height,
      ).toBeCloseTo(target)
    })

for (const destination of ['level', 'deck'] as const)
  it(`lands the last step flush with the ${destination} walking surface`, () => {
    const { stair, nodes } = buildScene({
      ...(destination === 'deck' ? { deckElevation: 1.25 } : { levelHeight: 5.3 }),
      floorElevation: 0.05,
    })
    const base = getFloorPlacedElevation({
      node: stair,
      nodes,
      position: stair.position,
      rotation: stair.rotation,
    })
    expect(base).toBeCloseTo(0.05)
    expect(base + resolveStairTotalRise(stair, nodes)).toBeCloseTo(
      destination === 'deck' ? 1.25 : 5.3,
    )
  })

it('converges to the level after detaching a deck and preserves detached authored flights', () => {
  const { stair, segments, nodes } = buildScene({
    deckElevation: 1.25,
    segments: [{ height: 1.25 }],
  })
  expect(syncStairRises(nodes)).toEqual([])
  const detached = { ...stair, deckSlabId: undefined }
  expect(syncStairRises({ ...nodes, [stair.id]: detached })).toEqual([
    { id: segments[0]!.id, data: { height: DEFAULT_LEVEL_HEIGHT } },
  ])
  expect(syncStairRises({ ...nodes, [stair.id]: { ...detached, totalRise: 2 } })).toEqual([])
})
