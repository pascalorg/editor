import { afterEach, expect, test } from 'bun:test'
import {
  applyZoneTransformPlan,
  createMezzanine,
  deleteZone,
  duplicateZone,
  setZoneIntent,
  structureChangeBatch,
  transformZone,
  ZoneIntentPatch,
} from '../commands/structure'
import { applyToScratch } from '../commands/structure/shared'
import { getFloorPlacedElevation } from '../hooks/spatial-grid/floor-placed-elevation'
import { spatialGridManager } from '../hooks/spatial-grid/spatial-grid-manager'
import { nodeRegistry, registerNode } from '../registry'
import {
  type AnyNode,
  CabinetNode,
  ItemNode,
  ShelfNode,
  type SlabNode,
  StairNode,
  StairSegmentNode,
  type ZoneNode,
} from '../schema'
import { type SceneCommit, subscribeSceneCommits } from '../store/history-control'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { migrateCeilingRoomLinks } from '../utils/room-zone-migration'
import { mezzanineFixture, mezzaninePolygon } from './__fixtures__/mezzanine'
import { exposedIntervals } from './level-footprints'
import { initSpaceDetectionSync } from './space-detection'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const asset = {
  id: 'chair',
  category: 'seating',
  name: 'Chair',
  thumbnail: '',
  src: 'asset://chair',
  dimensions: [0.5, 1, 0.5],
}
const item = (id: string, supportSlabId?: string) =>
  ItemNode.parse({ id, parentId: 'level_mezz', position: [2, 0, 2], supportSlabId, asset })
let stop = () => {}
afterEach(() => {
  stop()
  stop = () => {}
  spatialGridManager.clear()
  nodeRegistry._reset()
})
function registerItem() {
  nodeRegistry._reset()
  registerNode({
    kind: 'item',
    schemaVersion: 1,
    schema: ItemNode,
    category: 'utility',
    defaults: () => ({}),
    capabilities: {
      floorPlaced: { footprint: () => ({ dimensions: [0.5, 1, 0.5], rotation: [0, 0, 0] }) },
    },
  })
}
function store(nodes: Record<string, AnyNode>) {
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

test('H1 create pins every existing floor intent in the same commit; per-frame election stays on host', () => {
  const { before, host, mintId } = mezzanineFixture()
  const lower = item('item_lower')
  const pinned = item('item_pinned', 'ground')
  const cabinet = CabinetNode.parse({
    id: 'cabinet_lower',
    parentId: host.parentId,
    position: [2, 0, 2],
  })
  const shelf = ShelfNode.parse({ id: 'shelf_lower', parentId: host.parentId, position: [2, 0, 2] })
  const stair = StairNode.parse({ id: 'stair_lower', parentId: host.parentId, position: [2, 0, 2] })
  const outside = {
    ...lower,
    id: 'item_outside' as const,
    position: [6, 0, 2] as [number, number, number],
  }
  registerItem()
  store({
    ...before,
    ...Object.fromEntries([lower, pinned, cabinet, shelf, stair, outside].map((n) => [n.id, n])),
  })
  const initial = useScene.getState().nodes
  const ground = Object.values(before).find((n) => n.type === 'slab')!
  const commits: SceneCommit[] = []
  const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
  const plan = createMezzanine(initial, { hostZoneId: host.id, polygon: mezzaninePolygon, mintId })
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  unsubscribe()
  const nodes = useScene.getState().nodes
  for (const n of [lower, cabinet, shelf, stair])
    expect(nodes[n.id]).toMatchObject({ supportSlabId: ground.id })
  expect(nodes[pinned.id]).toEqual(pinned)
  expect(nodes[outside.id]).toEqual(outside)
  for (const slab of Object.values(nodes).filter((n) => n.type === 'slab'))
    spatialGridManager.handleNodeCreated(slab, host.parentId!)
  expect(
    getFloorPlacedElevation({ node: nodes[lower.id]!, nodes, position: lower.position }),
  ).toBeCloseTo(0.05)
  expect(
    getFloorPlacedElevation({
      node: { ...nodes[lower.id]!, supportSlabId: undefined } as AnyNode,
      nodes,
      position: lower.position,
    }),
  ).toBeCloseTo(2.5)
  expect(commits).toHaveLength(1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(initial)
  useScene.temporal.getState().redo()
  const upper = item('item_upper')
  const withUpper = { ...nodes, [upper.id]: upper }
  const deletion = deleteZone(withUpper, { zoneId: plan.zoneId, contents: 'delete' })
  expect(deletion.payload.itemIds).toEqual([upper.id])
})

for (const duplicate of [false, true])
  test(`H2 host ${duplicate ? 'duplicate' : 'move and rotate'} carries polygon, seed, grouping and support hosts`, () => {
    const f = mezzanineFixture()
    const ground = Object.values(f.nodes).find((n) => n.type === 'slab' && n.support !== 'open')!
    const lower = item('item_lower', ground.id)
    const upper = item('item_upper', f.plate.id)
    const stair = StairNode.parse({
      id: 'stair_copy',
      parentId: f.level.id,
      position: [2, 0, 2],
      deckSlabId: f.plate.id,
    })
    const ceiling = Object.values(f.nodes).find(
      (n) => n.type === 'ceiling' && n.zoneId === f.zone.id,
    )!
    const light = { ...item('item_light'), parentId: ceiling.id }
    const original = {
      ...f.nodes,
      [f.zone.id]: { ...f.zone, hostZoneId: 'zone_stale' },
      [lower.id]: lower,
      [upper.id]: upper,
      [stair.id]: stair,
      [light.id]: light,
    }
    let nodes: Record<string, AnyNode> = original
    const input = {
      zoneId: f.host.id,
      translate: [20, 0] as [number, number],
      rotate: { angle: Math.PI / 2, pivot: [0, 0] as [number, number] },
      mintId: f.mintId,
    }
    const plan = duplicate ? duplicateZone(nodes, input) : transformZone(nodes, input)
    expect(plan.conflicts).toBeUndefined()
    applyZoneTransformPlan(plan, {
      getNodes: () => nodes,
      applyChanges: (changes) => {
        nodes = applyToScratch(nodes, structureChangeBatch(changes))
      },
      reconcile: () => {
        nodes = f.reconcile(nodes).nodes
      },
    })
    const id = plan.idMap[f.zone.id]![0]!
    const copied = nodes[id] as ZoneNode
    expect(copied.polygon).toEqual(f.zone.polygon.map(([x, z]) => [20 + z, -x]))
    expect(copied.seed![0]).toBeCloseTo(20 + f.zone.seed![1])
    expect(copied.seed![1]).toBeCloseTo(-f.zone.seed![0])
    if (duplicate) {
      expect(nodes[f.zone.id]).toEqual(original[f.zone.id])
      expect(copied.hostZoneId).toBe(plan.zoneId)
      const plate = Object.values(nodes).find((n) => n.type === 'slab' && n.zoneIds?.includes(id))!
      expect(nodes[plan.idMap[upper.id]![0]!]).toMatchObject({ supportSlabId: plate.id })
      expect(nodes[plan.idMap[stair.id]![0]!]).toMatchObject({ deckSlabId: plate.id })
      const copiedGround = Object.values(nodes).find(
        (n) => n.type === 'slab' && n.zoneIds?.includes(plan.zoneId),
      )!
      expect(nodes[plan.idMap[lower.id]![0]!]).toMatchObject({ supportSlabId: copiedGround.id })
      const copiedCeiling = Object.values(nodes).find(
        (n) => n.type === 'ceiling' && n.zoneId === id,
      )!
      expect(nodes[plan.idMap[light.id]![0]!]).toMatchObject({ parentId: copiedCeiling.id })
    }
  })

for (const contents of ['keep', 'delete'] as const)
  test(`H3 deleting a host ${contents}s stacked contents in one undo step without orphan zones`, () => {
    const f = mezzanineFixture()
    const upper = item('item_upper', f.plate.id)
    store({ ...f.nodes, [f.zone.id]: { ...f.zone, hostZoneId: undefined }, [upper.id]: upper })
    const initial = useScene.getState().nodes
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((c) => commits.push(c))
    const plan = deleteZone(initial, { zoneId: f.host.id, contents })
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    unsubscribe()
    const nodes = useScene.getState().nodes
    expect(nodes[f.zone.id]).toBeUndefined()
    expect(nodes[f.plate.id]).toBeUndefined()
    expect(
      Object.values(nodes).filter((n) => n.type === 'zone' || n.type === 'ceiling'),
    ).toHaveLength(0)
    if (contents === 'keep')
      expect((nodes[upper.id] as import('../schema').ItemNode).supportSlabId).toBeUndefined()
    else expect(nodes[upper.id]).toBeUndefined()
    expect(commits).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(initial)
  })

test('H4 support cannot be set or cleared through zone intent', () => {
  const { nodes, zone, host } = mezzanineFixture()
  for (const support of ['open', null]) {
    const patch = { floor: { support } }
    expect(ZoneIntentPatch.safeParse(patch).success).toBe(false)
    expect(() => setZoneIntent(nodes, { zoneId: host.id, patch: patch as never })).toThrow()
  }
  for (const floor of [null, { elevation: null }])
    expect(setZoneIntent(nodes, { zoneId: zone.id, patch: { floor } }).conflicts?.[0]?.code).toBe(
      'mezzanine-intent',
    )
})

test('M5 elevation errors are structured and respect thickness and the storey margin', () => {
  const { before, nodes, zone, host, mintId } = mezzanineFixture()
  for (const elevation of [-1, 0.2, 4.71]) {
    const create = createMezzanine(before, {
      hostZoneId: host.id,
      polygon: mezzaninePolygon,
      elevation,
      mintId,
    })
    const edit = setZoneIntent(nodes, { zoneId: zone.id, patch: { floor: { elevation } } })
    for (const plan of [create, edit]) {
      expect(plan.changes).toEqual([])
      expect(plan.conflicts?.[0]?.code).toBe('mezzanine-elevation')
    }
  }
  expect(
    setZoneIntent(nodes, { zoneId: zone.id, patch: { floor: { thickness: 2.5 } } }).conflicts?.[0]
      ?.code,
  ).toBe('mezzanine-elevation')
  for (const elevation of [0.21, 4.7])
    expect(
      setZoneIntent(nodes, { zoneId: zone.id, patch: { floor: { elevation } } }).conflicts,
    ).toBeUndefined()
})

test('M6 a floor opt-out removes the mezzanine ceiling and restores the whole host ceiling', () => {
  const { nodes, zone, host, plate, apply } = mezzanineFixture()
  const changed = apply(
    nodes,
    setZoneIntent(nodes, { zoneId: zone.id, patch: { hasFloor: false } }),
  )
  expect(changed[plate.id]).toBeUndefined()
  expect(Object.values(changed).filter((n) => n.type === 'ceiling')).toMatchObject([
    { zoneId: host.id, holes: [] },
  ])
})

test('M7 overlapping stacked zones are refused but touching outlines are allowed', () => {
  const { nodes, host, mintId } = mezzanineFixture()
  expect(
    createMezzanine(nodes, { hostZoneId: host.id, polygon: mezzaninePolygon, mintId })
      .conflicts?.[0]?.code,
  ).toBe('overlaps-mezzanine')
  expect(
    createMezzanine(nodes, {
      hostZoneId: host.id,
      polygon: [
        [4, 0.1],
        [6, 0.1],
        [6, 3],
        [4, 3],
      ],
      mintId,
    }).conflicts,
  ).toBeUndefined()
})

test('M8 wall-centre outlines clip to wall faces and pin lower furniture in one undo step', () => {
  const { before, host, mintId } = mezzanineFixture()
  const lower = item('item_lower')
  store({ ...before, [lower.id]: lower })
  const initial = useScene.getState().nodes
  const ground = Object.values(before).find(
    (n) => n.type === 'slab' && n.zoneIds?.includes(host.id),
  )!
  const polygon: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const plan = createMezzanine(initial, { hostZoneId: host.id, polygon, mintId })
  expect(plan.conflicts).toBeUndefined()
  expect(plan.changes).toContainEqual({
    op: 'update',
    id: lower.id,
    data: { supportSlabId: ground.id },
  })
  applyZoneTransformPlan(plan)
  const nodes = useScene.getState().nodes
  expect(nodes[plan.zoneId]).toMatchObject({ polygon, hostZoneId: host.id })
  expect(nodes[lower.id]).toMatchObject({ supportSlabId: ground.id })
  const plate = Object.values(nodes).find(
    (n): n is SlabNode => n.type === 'slab' && !!n.zoneIds?.includes(plan.zoneId),
  )!
  expect(plate.polygon).toEqual(mezzaninePolygon)
  expect(plate.railing).toHaveLength(2)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(initial)
})

test('M10 exposed intervals include hole rings and railings leave a stair arrival gap', () => {
  const f = mezzanineFixture()
  const hole: [number, number][] = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
  ]
  expect(exposedIntervals([{ outer: f.plate.polygon, holes: [hole] }], []).length).toBe(8)
  const segment = StairSegmentNode.parse({
    id: 'sseg_arrival',
    parentId: 'stair_arrival',
    width: 1.2,
    length: 2,
    height: 2.5,
  })
  const stair = StairNode.parse({
    id: 'stair_arrival',
    parentId: f.level.id,
    position: [6, 0, 1.5],
    rotation: -Math.PI / 2,
    children: [segment.id],
    deckSlabId: f.plate.id,
  })
  store({
    ...f.nodes,
    [f.plate.id]: { ...f.plate, holes: [hole], holeMetadata: [{ source: 'manual' }] },
  })
  useScene.getState().applyNodeChanges({
    create: [
      { node: stair, parentId: f.level.id },
      { node: segment, parentId: stair.id },
    ],
  })
  const rails = () => (useScene.getState().nodes[f.plate.id] as SlabNode).railing!
  const length = () =>
    rails().reduce(
      (sum, { start, end }) => sum + Math.hypot(end[0] - start[0], end[1] - start[1]),
      0,
    )
  expect(length()).toBeCloseTo(2.9 + 3.9 + 4 - 1.2)
  useScene.getState().updateNode(segment.id, { width: 2 })
  expect(length()).toBeCloseTo(2.9 + 3.9 + 4 - 2)
  useScene.getState().updateNode(stair.id, { rotation: 0 })
  expect(length()).toBeCloseTo(2.9 + 3.9 + 4)
  useScene.getState().updateNode(stair.id, { position: [1.5, 0, 0], rotation: 0 })
  expect(length()).toBeLessThan(2.9 + 3.9 + 4)
  useScene.getState().deleteNode(stair.id)
  expect(length()).toBeCloseTo(2.9 + 3.9 + 4)
})

test('LOW ceiling migration repairs ordinary stale links while preserving mezzanine links', () => {
  const { nodes, host, zone } = mezzanineFixture()
  const ceiling = Object.values(nodes).find((n) => n.type === 'ceiling' && n.zoneId === host.id)!
  const changed = migrateCeilingRoomLinks({
    ...nodes,
    zone_wrong: { ...host, id: 'zone_wrong', polygon: host.polygon.map(([x, z]) => [x + 20, z]) },
    [ceiling.id]: { ...ceiling, holes: [], holeMetadata: [], zoneId: 'zone_wrong' },
  }).nodes
  expect(changed[ceiling.id]).toMatchObject({ zoneId: host.id })
  const mezzCeiling = Object.values(nodes).find(
    (n) => n.type === 'ceiling' && n.zoneId === zone.id,
  )!
  expect(changed[mezzCeiling.id]).toEqual(mezzCeiling)
})

for (const duplicate of [false, true])
  test(`H2 host ${duplicate ? 'duplicate' : 'transform'} with stacked contents publishes one commit and undoes completely`, () => {
    const f = mezzanineFixture()
    const upper = item('item_upper', f.plate.id)
    store({ ...f.nodes, [upper.id]: upper })
    const initial = useScene.getState().nodes
    const input = { zoneId: f.host.id, translate: [20, 0] as [number, number], mintId: f.mintId }
    const plan = duplicate ? duplicateZone(initial, input) : transformZone(initial, input)
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((c) => commits.push(c))
    applyZoneTransformPlan(plan)
    unsubscribe()
    expect(commits).toHaveLength(1)
    const nodes = useScene.getState().nodes
    expect(
      Object.values(nodes).filter((n) => n.type === 'zone' && n.floor?.support === 'open'),
    ).toHaveLength(duplicate ? 2 : 1)
    const targetZone = plan.idMap[f.zone.id]![0]!
    const plate = Object.values(nodes).find(
      (n) => n.type === 'slab' && n.zoneIds?.includes(targetZone),
    )!
    expect(nodes[plan.idMap[upper.id]![0]!]).toMatchObject({ supportSlabId: plate.id })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(initial)
  })

test('H1 deletion uses footprint election and hole veto, including items straddling open edges', () => {
  const f = mezzanineFixture()
  registerItem()
  const edge = { ...item('item_edge'), position: [4.1, 0, 2] as [number, number, number] }
  const inHole = item('item_hole')
  const plate = {
    ...f.plate,
    holes: [
      [
        [1.5, 1.5],
        [2.5, 1.5],
        [2.5, 2.5],
        [1.5, 2.5],
      ],
    ] as [number, number][][],
  }
  const nodes = { ...f.nodes, [plate.id]: plate, [edge.id]: edge, [inHole.id]: inHole }
  for (const slab of Object.values(nodes).filter((n) => n.type === 'slab'))
    spatialGridManager.handleNodeCreated(slab, f.level.id)
  expect(getFloorPlacedElevation({ node: edge, nodes, position: edge.position })).toBeCloseTo(2.5)
  expect(getFloorPlacedElevation({ node: inHole, nodes, position: inHole.position })).toBeCloseTo(
    0.05,
  )
  expect(deleteZone(nodes, { zoneId: f.zone.id, contents: 'delete' }).payload.itemIds).toEqual([
    edge.id,
  ])
})
