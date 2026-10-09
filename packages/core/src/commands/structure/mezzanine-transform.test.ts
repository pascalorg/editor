import { afterEach, expect, test } from 'bun:test'
import { mezzanineFixture } from '../../lib/__fixtures__/mezzanine'
import { initSpaceDetectionSync } from '../../lib/space-detection'
import { ItemNode, type SlabNode, StairNode, StairSegmentNode, type ZoneNode } from '../../schema'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import {
  applyZoneTransformPlan,
  createMezzanine,
  duplicateZone,
  planMezzanineStair,
  rotateZone,
  setZoneEdges,
  transformZone,
} from './index'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

let stop = () => {}
afterEach(() => {
  stop()
  stop = () => {}
})
function mount(nodes: ReturnType<typeof mezzanineFixture>['nodes']) {
  useScene.setState({
    nodes,
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
}
function furnished() {
  const f = mezzanineFixture()
  const ground = Object.values(f.nodes).find((n) => n.type === 'slab' && n.support !== 'open')!
  const upper = ItemNode.parse({
    id: 'item_upper',
    parentId: f.level.id,
    position: [2, 0, 2],
    supportSlabId: f.plate.id,
    asset: {
      id: 'chair',
      name: 'Chair',
      category: 'seating',
      thumbnail: '',
      src: 'asset://chair',
      dimensions: [0.5, 1, 0.5],
    },
  })
  const lower = { ...upper, id: 'item_lower' as const, supportSlabId: ground.id }
  const ceiling = Object.values(f.nodes).find(
    (n) => n.type === 'ceiling' && n.zoneId === f.zone.id,
  )!
  const light = { ...upper, id: 'item_light' as const, parentId: ceiling.id }
  const segment = StairSegmentNode.parse({ id: 'sseg_upper', parentId: 'stair_upper', length: 0.5 })
  const stair = StairNode.parse({
    id: 'stair_upper',
    parentId: f.level.id,
    position: [2, 0, 1],
    supportSlabId: f.plate.id,
    children: [segment.id],
  })
  return {
    ...f,
    nodes: {
      ...f.nodes,
      [upper.id]: upper,
      [lower.id]: lower,
      [light.id]: light,
      [stair.id]: stair,
      [segment.id]: segment,
    },
    upper,
    lower,
    light,
    stair,
    segment,
    ceiling,
  }
}

test('mezzanine move carries supported content and derived surfaces, never walls or lower furniture; host then carries it', () => {
  const f = furnished()
  mount(f.nodes)
  const before = useScene.getState().nodes
  const plan = transformZone(before, { zoneId: f.zone.id, translate: [1, 1], mintId: f.mintId })
  expect(plan.conflicts).toBeUndefined()
  expect(plan.changes.some((c) => c.op === 'create' || c.op === 'delete')).toBe(false)
  applyZoneTransformPlan(plan)
  const nodes = useScene.getState().nodes
  expect(nodes[f.zone.id]).toMatchObject({ hostZoneId: f.host.id })
  expect(nodes[f.plate.id]).toMatchObject({
    polygon: f.zone.polygon.map(([x, z]) => [x + 1, z + 1]),
  })
  expect(nodes[f.ceiling.id]).toMatchObject({ polygon: (nodes[f.zone.id] as ZoneNode).polygon })
  expect(nodes[f.upper.id]).toMatchObject({ position: [3, 0, 3], supportSlabId: f.plate.id })
  expect(nodes[f.stair.id]).toMatchObject({ position: [3, 0, 2], supportSlabId: f.plate.id })
  expect(nodes[f.segment.id]).toEqual(f.segment)
  expect(nodes[f.light.id]).toMatchObject({ position: [3, 0, 3] })
  expect(nodes[f.lower.id]).toEqual(f.lower)
  for (const wall of f.walls) expect(nodes[wall.id]).toEqual(before[wall.id])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  useScene.temporal.getState().redo()
  applyZoneTransformPlan(
    transformZone(nodes, { zoneId: f.host.id, translate: [20, 0], mintId: f.mintId }),
  )
  expect(useScene.getState().nodes[f.zone.id]).toMatchObject({
    polygon: f.zone.polygon.map(([x, z]) => [x + 21, z + 1]),
    hostZoneId: f.host.id,
  })
  expect(useScene.getState().nodes[f.upper.id]).toMatchObject({ position: [23, 0, 3] })
})

test('quarter turns use exact mezzanine centroid, carry orientations, and roundtrip', () => {
  const f = furnished()
  const moved = f.apply(
    f.nodes,
    transformZone(f.nodes, { zoneId: f.zone.id, translate: [1, 1], mintId: f.mintId }),
  )
  const left = rotateZone(moved, { zoneId: f.zone.id, quarterTurns: 1, mintId: f.mintId })
  expect(left.conflicts).toBeUndefined()
  const rotated = f.apply(moved, left)
  expect(rotated[f.stair.id]).toMatchObject({ rotation: Math.PI / 2 })
  const right = rotateZone(rotated, { zoneId: f.zone.id, quarterTurns: -1, mintId: f.mintId })
  const restored = f.apply(rotated, right)[f.zone.id] as ZoneNode
  for (const [i, p] of restored.polygon.entries())
    for (const [j, v] of p.entries())
      expect(v).toBeCloseTo((moved[f.zone.id] as ZoneNode).polygon[i]![j]!)
})

test('duplicate searches fitting offsets and rehosts copied items, stairs, segments and ceiling fixtures in one undo', () => {
  const f = furnished()
  mount(f.nodes)
  const plan = duplicateZone(f.nodes, { zoneId: f.zone.id, translate: [100, 0], mintId: f.mintId })
  expect(plan.conflicts).toBeUndefined()
  applyZoneTransformPlan(plan)
  const nodes = useScene.getState().nodes
  const plate = Object.values(nodes).find(
    (n) => n.type === 'slab' && n.zoneIds?.includes(plan.zoneId),
  )!
  expect(nodes[plan.zoneId]).toMatchObject({ hostZoneId: f.host.id })
  expect(nodes[plan.idMap[f.upper.id]![0]!]).toMatchObject({ supportSlabId: plate.id })
  const stair = nodes[plan.idMap[f.stair.id]![0]!]!
  expect(stair).toMatchObject({
    supportSlabId: plate.id,
    children: [plan.idMap[f.segment.id]![0]!],
  })
  expect(StairSegmentNode.safeParse(nodes[plan.idMap[f.segment.id]![0]!]).success).toBe(true)
  expect(plan.idMap[f.lower.id]).toBeUndefined()
  expect(nodes[f.zone.id]).toEqual(f.zone)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(f.nodes)
})

test('edge push grows and shrinks the plate in one undo without wall writes', () => {
  const f = mezzanineFixture()
  mount(f.nodes)
  const plan = setZoneEdges(f.nodes, { zoneId: f.zone.id, edgeIndex: 1, distance: 1 })
  expect(plan.conflicts).toBeUndefined()
  applyZoneTransformPlan(plan)
  expect((useScene.getState().nodes[f.plate.id] as SlabNode).polygon).toEqual([
    [0.1, 0.1],
    [5, 0.1],
    [5, 3],
    [0.1, 3],
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(f.nodes)
  const shrunk = f.apply(
    f.nodes,
    setZoneEdges(f.nodes, { zoneId: f.zone.id, edgeIndex: 1, distance: -1 }),
  )
  expect((shrunk[f.zone.id] as ZoneNode).polygon[1]).toEqual([3, 0.1])
})

test('all mezzanine refusals write nothing, including force, overlapping siblings and no duplicate space', () => {
  const f = mezzanineFixture()
  const snapshot = structuredClone(f.nodes)
  const sibling = createMezzanine(f.nodes, {
    hostZoneId: f.host.id,
    polygon: [
      [5, 1],
      [7, 1],
      [7, 4],
      [5, 4],
    ],
    mintId: f.mintId,
  })
  const nodes = f.apply(f.nodes, sibling)
  const plans = [
    [
      transformZone(f.nodes, {
        zoneId: f.zone.id,
        translate: [-1, 0],
        force: true,
        mintId: f.mintId,
      }),
      'outside-host',
    ],
    [rotateZone(f.nodes, { zoneId: f.zone.id, quarterTurns: 1, mintId: f.mintId }), 'outside-host'],
    [
      transformZone(nodes, { zoneId: f.zone.id, translate: [3, 1], mintId: f.mintId }),
      'overlaps-mezzanine',
    ],
    [setZoneEdges(f.nodes, { zoneId: f.zone.id, edgeIndex: 1, distance: -3.8 }), 'too-small'],
    [setZoneEdges(f.nodes, { zoneId: f.zone.id, edgeIndex: 1, distance: 10 }), 'outside-host'],
  ] as const
  for (const [plan, code] of plans) {
    expect(plan.changes).toEqual([])
    expect(plan.conflicts?.[0]?.code).toBe(code)
  }
  expect(f.nodes).toEqual(snapshot)
  const full = createMezzanine(f.before, {
    hostZoneId: f.host.id,
    polygon: [
      [0.1, 0.1],
      [7.9, 0.1],
      [7.9, 5.9],
      [0.1, 5.9],
    ],
    mintId: f.mintId,
  })
  const fullNodes = f.apply(f.before, full)
  const refused = duplicateZone(fullNodes, {
    zoneId: full.zoneId,
    translate: [0, 0],
    mintId: f.mintId,
  })
  expect(refused.changes).toEqual([])
  expect(refused.conflicts?.[0]?.code).toBe('overlaps-mezzanine')
})

test('shared create validation reports crossing edges before area and rejects outside reference boundaries', () => {
  const f = mezzanineFixture()
  for (const [polygon, code] of [
    [
      [
        [1, 1],
        [4, 4],
        [1, 4],
        [4, 1],
      ],
      'self-intersecting',
    ],
    [
      [
        [-0.1, 0],
        [2, 0],
        [2, 2],
        [-0.1, 2],
      ],
      'outside-host',
    ],
  ] as const) {
    const plan = createMezzanine(f.before, {
      hostZoneId: f.host.id,
      polygon: polygon.map(([x, z]) => [x, z]),
      mintId: f.mintId,
    })
    expect(plan.changes).toEqual([])
    expect(plan.conflicts?.[0]?.code).toBe(code)
  }
})

const railingLength = (plate: SlabNode) =>
  plate.railing!.reduce(
    (sum, { start, end }) => sum + Math.hypot(end[0] - start[0], end[1] - start[1]),
    0,
  )
test('stair planner picks longest free edge, arrives flush, opens railing and applies in one undo step', () => {
  const f = mezzanineFixture()
  mount(f.nodes)
  const plan = planMezzanineStair(f.nodes, f.zone.id)
  expect(plan.conflicts).toBeUndefined()
  expect(plan.edgeIndex).toBe(1)
  applyZoneTransformPlan(plan)
  const nodes = useScene.getState().nodes
  const stair = nodes[plan.stairId!] as StairNode
  const segment = nodes[stair.children[0]!] as StairSegmentNode
  expect(stair).toMatchObject({
    parentId: f.level.id,
    deckSlabId: f.plate.id,
    rotation: -Math.PI / 2,
  })
  expect(segment.height).toBeCloseTo(2.45)
  expect(segment.height / segment.stepCount).toBeLessThanOrEqual(0.18)
  expect(segment.length / segment.stepCount).toBeGreaterThanOrEqual(0.25)
  expect(stair.position[0] - segment.length).toBeCloseTo(4)
  expect(stair.position[2]).toBeCloseTo(1.55)
  expect(railingLength(nodes[f.plate.id] as SlabNode)).toBeCloseTo(
    railingLength(f.plate) - stair.width,
  )
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(f.nodes)
})

test('stair planner refuses without writes when walls or item footprints block every run', () => {
  const f = furnished()
  const blocker = {
    ...f.lower,
    position: [6, 0, 3] as [number, number, number],
    asset: { ...f.lower.asset, dimensions: [4, 1, 6] as [number, number, number] },
  }
  const nodes = { ...f.nodes, [blocker.id]: blocker }
  const before = structuredClone(nodes)
  expect(planMezzanineStair(nodes, f.zone.id)).toMatchObject({
    changes: [],
    conflicts: [{ code: 'no-room-for-stair' }],
  })
  expect(nodes).toEqual(before)
})

test('edge pushes respect clockwise winding and refuse crossing a concave boundary', () => {
  const f = mezzanineFixture()
  const clockwise = { ...f.zone, polygon: [...f.zone.polygon].reverse() }
  const nodes = { ...f.nodes, [clockwise.id]: clockwise }
  const plan = setZoneEdges(nodes, { zoneId: clockwise.id, edgeIndex: 1, distance: 1 })
  expect(plan.conflicts).toBeUndefined()
  const grown = f.apply(nodes, plan)[clockwise.id] as ZoneNode
  expect(grown.polygon[1]![0]).toBe(5)
  const concave = createMezzanine(f.before, {
    hostZoneId: f.host.id,
    polygon: [
      [1, 1],
      [4, 1],
      [4, 2],
      [2, 2],
      [2, 4],
      [1, 4],
    ],
    mintId: f.mintId,
  })
  const concaveNodes = f.apply(f.before, concave)
  mount(concaveNodes)
  const invalid = setZoneEdges(concaveNodes, { zoneId: concave.zoneId, edgeIndex: 0, distance: -2 })
  expect(invalid).toMatchObject({ changes: [], conflicts: [{ code: 'self-intersecting' }] })
  applyZoneTransformPlan(invalid)
  expect(useScene.getState().nodes).toEqual(concaveNodes)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('stair planner skips a blocked longer edge for a free edge and sizes the rise from the host floor', () => {
  const f = mezzanineFixture()
  const host = { ...f.host, floor: { ...f.host.floor, elevation: 0.5 } }
  const before = f.reconcile({ ...f.before, [host.id]: host }).nodes
  const mezzanine = createMezzanine(before, {
    hostZoneId: host.id,
    polygon: [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ],
    elevation: 2,
    mintId: f.mintId,
  })
  const nodes = f.apply(before, mezzanine)
  const sibling = createMezzanine(nodes, {
    hostZoneId: host.id,
    polygon: [
      [3, 0.1],
      [7.9, 0.1],
      [7.9, 4],
      [3, 4],
    ],
    mintId: f.mintId,
  })
  const blocked = f.apply(nodes, sibling)
  const plan = planMezzanineStair(blocked, mezzanine.zoneId)
  expect(plan.conflicts).toBeUndefined()
  expect(plan.edgeIndex).toBe(2)
  const after = f.apply(blocked, plan)
  const stair = after[plan.stairId!] as StairNode
  const segment = after[stair.children[0]!] as StairSegmentNode
  expect(segment.height).toBeCloseTo(1.5)
  expect(segment.length / segment.stepCount).toBeGreaterThanOrEqual(0.25)
  expect(stair.position[2] - segment.length).toBeCloseTo(3)
  const deck = after[stair.deckSlabId!] as SlabNode
  expect(railingLength(deck)).toBeCloseTo(railingLength(blocked[deck.id] as SlabNode) - stair.width)
})

function hasNegativeZero(value: unknown): boolean {
  if (typeof value === 'number') return Object.is(value, -0)
  if (Array.isArray(value)) return value.some(hasNegativeZero)
  return !!value && typeof value === 'object' && Object.values(value).some(hasNegativeZero)
}

test('stair planner canonicalizes atan2 signed zero before committing', () => {
  const f = mezzanineFixture()
  const mezzanine = createMezzanine(f.before, {
    hostZoneId: f.host.id,
    polygon: [
      [1, 4],
      [7, 4],
      [7, 5],
      [1, 5],
    ],
    mintId: f.mintId,
  })
  const nodes = f.apply(f.before, mezzanine)
  const plan = planMezzanineStair(nodes, mezzanine.zoneId)
  expect(plan.conflicts).toBeUndefined()
  expect(plan.edgeIndex).toBe(0)
  const stair = plan.changes.find((c) => c.op === 'create' && c.node.type === 'stair')
  expect(stair).toMatchObject({ node: { rotation: 0 } })
  expect(hasNegativeZero(plan.changes)).toBe(false)
  mount(nodes)
  applyZoneTransformPlan(plan)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(nodes)
})

test('move and duplicate canonicalize signed zero in content poses', () => {
  const f = furnished()
  const stair = { ...f.stair, rotation: -0, position: [2, -0, 1] as [number, number, number] }
  const nodes = { ...f.nodes, [stair.id]: stair }
  for (const planner of [transformZone, duplicateZone]) {
    const plan = planner(nodes, {
      zoneId: f.zone.id,
      translate: [1, 0],
      rotate: { angle: -0 },
      mintId: f.mintId,
    })
    expect(plan.conflicts).toBeUndefined()
    expect(hasNegativeZero(plan.changes)).toBe(false)
  }
})

function insidePlan(polygon: [number, number][], extra: Record<string, unknown> = {}) {
  const f = mezzanineFixture()
  const mezzanine = createMezzanine(f.before, { hostZoneId: f.host.id, polygon, mintId: f.mintId })
  const nodes = { ...f.apply(f.before, mezzanine), ...extra } as typeof f.nodes
  const plan = planMezzanineStair(nodes, mezzanine.zoneId, 'inside')
  const created = (type: string) =>
    plan.changes.flatMap((c) => (c.op === 'create' && c.node.type === type ? [c.node] : []))[0]
  return {
    nodes,
    plan,
    stair: created('stair') as StairNode | undefined,
    segment: created('stair-segment') as StairSegmentNode | undefined,
    deck: Object.values(nodes).find(
      (n): n is SlabNode => n.type === 'slab' && !!n.zoneIds?.includes(mezzanine.zoneId),
    )!,
  }
}

/** Where the flight's top step ends, and the point one stair width further on. */
function topAndBeyond(stair: StairNode, segment: StairSegmentNode) {
  const dir = [Math.sin(stair.rotation), Math.cos(stair.rotation)] as const
  const at = (d: number) => [stair.position[0] + dir[0] * d, stair.position[2] + dir[1] * d]
  return { top: at(segment.length), beyond: at(segment.length + stair.width) }
}

const inBox = (polygon: [number, number][], [x, z]: number[]) => {
  const xs = polygon.map(([px]) => px)
  const zs = polygon.map(([, pz]) => pz)
  return (
    x! >= Math.min(...xs) - 1e-6 &&
    x! <= Math.max(...xs) + 1e-6 &&
    z! >= Math.min(...zs) - 1e-6 &&
    z! <= Math.max(...zs) + 1e-6
  )
}

test('inside stair climbs from an open edge through its own deck and leaves a top landing', () => {
  const { plan, stair, segment, deck } = insidePlan([
    [1.5, 0.1],
    [7.9, 0.1],
    [7.9, 3],
    [1.5, 3],
  ])
  expect(plan.conflicts).toBeUndefined()
  // The west edge is the only one with free host floor in front of it.
  expect(plan.edgeIndex).toBe(3)
  expect(stair).toMatchObject({ deckSlabId: deck.id, slabOpeningMode: 'destination' })
  expect(stair!.rotation).toBeCloseTo(Math.PI / 2)
  expect(stair!.position[0]).toBeCloseTo(1.5)
  expect(segment!.length / segment!.stepCount).toBeGreaterThanOrEqual(0.25)
  const { top, beyond } = topAndBeyond(stair!, segment!)
  expect(inBox(deck.polygon, top)).toBe(true)
  expect(inBox(deck.polygon, beyond)).toBe(true)
})

test('inside stair shortens its run to keep a landing on a shallow deck', () => {
  const { plan, stair, segment, deck } = insidePlan([
    [1.5, 0.1],
    [6.2, 0.1],
    [6.2, 3],
    [1.5, 3],
  ])
  expect(plan.conflicts).toBeUndefined()
  expect(segment!.length).toBeLessThan(4.7 - stair!.width + 1e-3)
  expect(segment!.length / segment!.stepCount).toBeGreaterThanOrEqual(0.25)
  expect(inBox(deck.polygon, topAndBeyond(stair!, segment!).beyond)).toBe(true)
})

test('inside stair respects walls under the deck and refuses without writes', () => {
  const f = mezzanineFixture()
  const wall = { ...f.walls[0]!, id: 'wall_under_deck' as const, start: [3, 0], end: [3, 3.5] }
  const polygon: [number, number][] = [
    [1.5, 0.1],
    [7.9, 0.1],
    [7.9, 3],
    [1.5, 3],
  ]
  expect(insidePlan(polygon).plan.conflicts).toBeUndefined()
  const { nodes, plan } = insidePlan(polygon, { [wall.id]: wall })
  expect(plan).toMatchObject({ changes: [], conflicts: [{ code: 'no-room-for-stair' }] })
  expect(nodes[wall.id]).toBe(wall)
})

test('outside placement is the default and leaves the deck uncut', () => {
  const f = mezzanineFixture()
  const byDefault = planMezzanineStair(f.nodes, f.zone.id)
  const outside = planMezzanineStair(f.nodes, f.zone.id, 'outside')
  expect(outside.edgeIndex).toBe(byDefault.edgeIndex)
  const stair = outside.changes.find((c) => c.op === 'create' && c.node.type === 'stair')
  expect(stair).toMatchObject({ node: { slabOpeningMode: 'none', rotation: -Math.PI / 2 } })
})
