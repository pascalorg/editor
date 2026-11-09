import { afterEach, describe, expect, test } from 'bun:test'
import { area, containsPoint } from '../../lib/polygon-boolean'
import { initSpaceDetectionSync } from '../../lib/space-detection'
import { reconcileLevelStructure } from '../../lib/structure-kernel'
import { shelfRecipe } from '../../procedural-items/fixtures'
import { ProceduralItemNode } from '../../procedural-items/node'
import {
  BuildingNode,
  CabinetNode,
  ConstructionDimensionNode,
  DoorNode,
  GuideNode,
  ItemNode,
  LevelNode,
  MeasurementNode,
  RoofNode,
  RoofSegmentNode,
  ScanNode,
  SeparatorNode,
  ShelfNode,
  SlabNode,
  SpawnNode,
  StairNode,
  WallNode,
  WindowNode,
  type ZoneNode,
} from '../../schema'
import { isDerivedNode } from '../../store/derived-node-guard'
import { subscribeSceneCommits } from '../../store/history-control'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { getWallFaceLine } from '../../systems/wall/wall-frame'
import {
  applyZoneTransformPlan,
  createZone,
  divideZone,
  duplicateZone,
  lockOutsideFaces,
  resolveZoneTransformHosts,
  rotateZone,
  setWallGeometry,
  transformZone,
} from './index'
import {
  applyToScratch,
  roomFace,
  type StructureNodes,
  type StructurePlan,
  structureChangeBatch,
} from './shared'

const levelId = 'level_transform'
function mint() {
  let i = 0
  return (kind: string) => `${kind}_transform${++i}`
}
const rectangle = (x = 0, z = 0, w = 4, h = 4): [number, number][] => [
  [x, z],
  [x + w, z],
  [x + w, z + h],
  [x, z + h],
]
function reconcile(before: StructureNodes, plan: StructurePlan) {
  expect(plan.conflicts).toBeUndefined()
  const scratch = applyToScratch(before, structureChangeBatch(plan.changes))
  let i = 0
  const result = reconcileLevelStructure({
    nodes: scratch,
    previousNodes: before,
    levelId,
    mintId: (kind) => {
      let id: string
      do {
        id = `${kind}_derived${++i}`
      } while (scratch[id])
      return id
    },
  })
  const derived = applyToScratch(scratch, structureChangeBatch(result.patches))
  return applyToScratch(derived, structureChangeBatch(resolveZoneTransformHosts(derived, plan)))
}
function fixture() {
  const mintId = mint()
  const level = LevelNode.parse({ id: levelId, parentId: 'building_transform' })
  const building = BuildingNode.parse({ id: 'building_transform', children: [levelId] })
  const initial = { [level.id]: level, [building.id]: building }
  const created = createZone(initial, {
    levelId,
    polygon: rectangle(),
    enclose: true,
    name: 'Kitchen',
    mintId,
  })
  return { nodes: reconcile(initial, created), zoneId: created.zoneId, mintId }
}
function addRoom(
  nodes: StructureNodes,
  mintId: ReturnType<typeof mint>,
  polygon: [number, number][],
) {
  const created = createZone(nodes, { levelId, polygon, enclose: true, mintId })
  return { nodes: reconcile(nodes, created), zoneId: created.zoneId }
}
const asset = {
  id: 'chair',
  category: 'furniture',
  name: 'Chair',
  thumbnail: '',
  src: 'https://example.com/chair.glb',
}
function door(nodes: StructureNodes, wall: WallNode, id: string, station = 2) {
  const node = DoorNode.parse({ id, parentId: wall.id, wallId: wall.id, position: [station, 0, 0] })
  return { ...nodes, [wall.id]: { ...wall, children: [...wall.children, node.id] }, [id]: node }
}
function rooms(nodes: StructureNodes) {
  return Object.values(nodes).filter((n): n is ZoneNode => n.type === 'zone')
}
function walls(nodes: StructureNodes) {
  return Object.values(nodes).filter((n): n is WallNode => n.type === 'wall')
}
function assertEnclosed(nodes: StructureNodes, count: number) {
  expect(rooms(nodes)).toHaveLength(count)
  for (const zone of rooms(nodes)) expect(roomFace(nodes, zone)).toBeDefined()
}
function expectNoDuplicateBoundaries(nodes: StructureNodes) {
  const keys = Object.values(nodes)
    .filter((node) => node.type === 'wall' || node.type === 'separator')
    .map((node) =>
      [node.start, node.end]
        .map((point) => point.map((value) => value.toFixed(6)).join(','))
        .sort()
        .join('|'),
    )
  expect(new Set(keys).size).toBe(keys.length)
}
let stop = () => {}
afterEach(() => {
  stop()
  useScene.temporal.getState().resume()
})
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

function mount(nodes: StructureNodes) {
  useScene.setState({
    nodes,
    rootNodeIds: ['building_transform'],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  })
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  clearSceneHistory()
}

describe('room transforms', () => {
  test('move isolated room keeps identity, moves contents and re-derives plate and ceiling in one undo step', () => {
    const { nodes, zoneId, mintId } = fixture()
    const wall = walls(nodes)[0]!
    const withDoor = door(nodes, wall, 'door_moving')
    const item = ItemNode.parse({
      id: 'item_moving',
      parentId: levelId,
      position: [1, 0, 2],
      children: ['item_nested'],
      asset,
    })
    const nested = ItemNode.parse({
      id: 'item_nested',
      parentId: item.id,
      position: [0, 1, 0],
      asset,
    })
    useScene.setState({
      nodes: { ...withDoor, [item.id]: item, [nested.id]: nested },
      rootNodeIds: ['building_transform'],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      readOnly: false,
    })
    stop = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces: () => {} }),
    })
    clearSceneHistory()
    const before = useScene.getState().nodes
    const plan = transformZone(before, { zoneId, translate: [10, 3], mintId })
    expect(
      plan.changes.every((change) =>
        change.op === 'create' ? !isDerivedNode(change.node) : !isDerivedNode(before[change.id]!),
      ),
    ).toBe(true)
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    const after = useScene.getState().nodes
    expect(after[zoneId]).toMatchObject({ name: 'Kitchen', seed: [12, 5] })
    expect(after[item.id]).toMatchObject({ position: [11, 0, 5] })
    expect(after[nested.id]).toMatchObject({ position: nested.position, parentId: item.id })
    expect(after['door_moving']).toMatchObject({ parentId: wall.id, position: [2, 0, 0] })
    for (const node of Object.values(after))
      if (isDerivedNode(node) && 'polygon' in node)
        expect(Math.min(...node.polygon.map((p) => p[0]))).toBeGreaterThan(9)
    assertEnclosed(after, 1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(after)
  })
  test('move shared wall leaves neighbour and door intact and takes a plain enclosed copy', () => {
    const { nodes, zoneId, mintId } = fixture()
    const adjacent = addRoom(nodes, mintId, rectangle(4))
    const shared = walls(adjacent.nodes).find((wall) => wall.start[0] === 4 && wall.end[0] === 4)!
    const graph = door(adjacent.nodes, shared, 'door_neighbour')
    const plan = transformZone(graph, { zoneId, translate: [-10, 0], mintId })
    const after = reconcile(graph, plan)
    expect(after[shared.id]).toMatchObject({
      start: shared.start,
      end: shared.end,
      children: ['door_neighbour'],
    })
    expect(after['door_neighbour']).toEqual(graph['door_neighbour'])
    const copy = after[plan.idMap[shared.id]![0]!] as WallNode
    expect(copy.id).not.toBe(shared.id)
    expect(copy.children).toEqual([])
    expect(copy.start[0]).toBe(-6)
    expect(after[adjacent.zoneId]).toMatchObject({
      polygon: (graph[adjacent.zoneId] as ZoneNode).polygon,
    })
    assertEnclosed(after, 2)
  })
  test('drop collinear walls preserves destination ID and hosted children on both sides, including reversed frames', () => {
    const { nodes, zoneId, mintId } = fixture()
    const adjacent = addRoom(nodes, mintId, rectangle(10))
    const placed = walls(adjacent.nodes).find((wall) => wall.start[0] === 4 && wall.end[0] === 4)!
    const destination = walls(adjacent.nodes).find(
      (wall) => wall.start[0] === 10 && wall.end[0] === 10,
    )!
    let graph = door(adjacent.nodes, placed, 'door_placed', 1)
    graph = door(graph, destination, 'door_destination', 1)
    const plan = transformZone(graph, { zoneId, translate: [6, 0], mintId })
    const after = reconcile(graph, plan)
    expect(after[placed.id]).toBeUndefined()
    expect(after[destination.id]).toMatchObject({ start: destination.start, end: destination.end })
    expect((after[destination.id] as WallNode).children.sort()).toEqual([
      'door_destination',
      'door_placed',
    ])
    expect(after['door_destination']).toMatchObject({ position: [1, 0, 0] })
    expect(after['door_placed']).toMatchObject({
      parentId: destination.id,
      wallId: destination.id,
      position: [3, 0, -0],
    })
    assertEnclosed(after, 2)
    useScene.setState({
      nodes: graph,
      rootNodeIds: ['building_transform'],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      readOnly: false,
    })
    stop = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces: () => {} }),
    })
    clearSceneHistory()
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    const committed = useScene.getState().nodes
    expect(committed['door_placed']).toMatchObject({ parentId: destination.id })
    expect(committed['door_destination']).toBeDefined()
    assertEnclosed(committed, 2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(graph)
  })
  test('partial collinear drop retains destination on overlap and children on both leftover spans', () => {
    const { nodes, zoneId, mintId } = fixture()
    const adjacent = addRoom(nodes, mintId, rectangle(10, 2, 4, 4))
    const placed = walls(adjacent.nodes).find((wall) => wall.start[0] === 4 && wall.end[0] === 4)!
    const destination = walls(adjacent.nodes).find(
      (wall) => wall.start[0] === 10 && wall.end[0] === 10,
    )!
    let graph = door(adjacent.nodes, placed, 'door_placed_tail', 1)
    graph = door(graph, placed, 'door_placed_shared', 3)
    graph = door(graph, destination, 'door_destination_tail', 1)
    const after = reconcile(graph, transformZone(graph, { zoneId, translate: [6, 0], mintId }))
    expect(after[destination.id]).toMatchObject({ start: [10, 4], end: [10, 2] })
    for (const id of ['door_placed_tail', 'door_placed_shared', 'door_destination_tail']) {
      const child = after[id]!
      expect(child).toBeDefined()
      expect((after[child.parentId!] as WallNode).children).toContain(id)
    }
    expect(after['door_placed_shared']!.parentId).toBe(destination.id)
    assertEnclosed(after, 2)
  })
  test('rotate 90 degrees about room centre rotates regions and free items while keeping hosted local poses', () => {
    const { nodes, zoneId, mintId } = fixture()
    const zone = nodes[zoneId] as ZoneNode
    const item = ItemNode.parse({
      id: 'item_rotated',
      parentId: levelId,
      position: [1, 0, 1],
      asset,
    })
    const graph = {
      ...nodes,
      [zoneId]: {
        ...zone,
        floor: {
          finish: 'wood',
          regions: [{ id: 'region_one', polygon: rectangle(0, 0, 1, 1), finish: 'tile' }],
        },
      },
      [item.id]: item,
    }
    const after = reconcile(
      graph,
      transformZone(graph, { zoneId, rotate: { angle: Math.PI / 2 }, mintId }),
    )
    expect(after[item.id]).toMatchObject({ rotation: [0, Math.PI / 2, 0] })
    const position = (after[item.id] as ItemNode).position
    expect(position[0]).toBeCloseTo(1)
    expect(position[2]).toBeCloseTo(3)
    const region = (after[zoneId] as ZoneNode).floor!.regions![0]!
    expect(region.polygon).toEqual(
      expect.arrayContaining([
        [0, 4],
        [1, 4],
        [1, 3],
        [0, 3],
      ]),
    )
    assertEnclosed(after, 1)
  })
  test('duplicate next to source remaps manual support and deck IDs and never authors derived nodes', () => {
    const { nodes, zoneId, mintId } = fixture()
    const slab = SlabNode.parse({
      id: 'slab_manual',
      parentId: levelId,
      polygon: rectangle(1, 1, 1, 1),
      elevation: 0.5,
    })
    const item = ItemNode.parse({
      id: 'item_copy',
      parentId: levelId,
      position: [1.5, 0, 1.5],
      supportSlabId: slab.id,
      children: ['item_child'],
      asset,
    })
    const child = ItemNode.parse({
      id: 'item_child',
      parentId: item.id,
      position: [0, 1, 0],
      asset,
    })
    const stair = StairNode.parse({
      id: 'stair_copy',
      parentId: levelId,
      position: [2, 0, 2],
      deckSlabId: slab.id,
      supportSlabId: slab.id,
    })
    const graph = {
      ...nodes,
      [slab.id]: slab,
      [item.id]: item,
      [child.id]: child,
      [stair.id]: stair,
    }
    const before = JSON.stringify(graph)
    const plan = duplicateZone(graph, { zoneId, translate: [6, 0], mintId })
    expect(JSON.stringify(graph)).toBe(before)
    expect(
      plan.changes.some((change) => change.op === 'create' && isDerivedNode(change.node)),
    ).toBe(false)
    const after = reconcile(graph, plan)
    expect(after[zoneId]).toEqual(graph[zoneId])
    for (const wall of walls(graph)) expect(after[wall.id]).toEqual(wall)
    const copied = after[plan.idMap[item.id]![0]!] as ItemNode
    expect(copied.supportSlabId).toBe(plan.idMap[slab.id]![0])
    expect(after[plan.idMap[stair.id]![0]!]).toMatchObject({
      deckSlabId: plan.idMap[slab.id]![0],
      supportSlabId: plan.idMap[slab.id]![0],
    })
    expect(after[plan.idMap[child.id]![0]!]).toMatchObject({
      parentId: copied.id,
      position: child.position,
    })
    assertEnclosed(after, 2)
  })
  test('crossing a neighbour splits both walls and re-derives rooms without overlap conflicts', () => {
    const { nodes, zoneId, mintId } = fixture()
    const neighbour = addRoom(nodes, mintId, rectangle(8))
    const graph = {
      ...neighbour.nodes,
      [neighbour.zoneId]: { ...neighbour.nodes[neighbour.zoneId], name: 'Bedroom' },
    } as StructureNodes
    mount(graph)
    const plan = transformZone(graph, { zoneId, translate: [9, 1], mintId })
    expect(plan.conflicts).toBeUndefined()
    applyZoneTransformPlan(plan)
    const after = useScene.getState().nodes
    expect(walls(after)).toHaveLength(12)
    assertEnclosed(after, 3)
    expect(after[zoneId]).toMatchObject({ name: 'Kitchen' })
    expect(after[neighbour.zoneId]).toMatchObject({ name: 'Bedroom' })
    expect(area([{ outer: (after[zoneId] as ZoneNode).polygon, holes: [] }])).toBeCloseTo(9)
    expect(area([{ outer: (after[neighbour.zoneId] as ZoneNode).polygon, holes: [] }])).toBeCloseTo(
      7,
    )
    for (const point of [
      [12, 1],
      [9, 4],
    ])
      expect(
        walls(after).filter((wall) =>
          [wall.start, wall.end].some((end) => JSON.stringify(end) === JSON.stringify(point)),
        ),
      ).toHaveLength(4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(graph)
  })
  test('lock outside faces then change thickness preserves the four outer dimensions', () => {
    const { nodes, mintId } = fixture()
    const before = walls(nodes).map((wall) => ({
      start: { x: wall.start[0], y: wall.start[1] },
      end: { x: wall.end[0], y: wall.end[1] },
    }))
    const plan = lockOutsideFaces(nodes, { levelId })
    let after = reconcile(nodes, plan)
    expect(walls(after).every((wall) => wall.justification === 'a')).toBe(true)
    for (const wall of walls(after))
      after = reconcile(after, setWallGeometry(after, { wallId: wall.id, thickness: 0.5, mintId }))
    for (const [i, wall] of walls(after).entries()) {
      const line = getWallFaceLine(wall, 'b'),
        original = before[i]!
      if (Math.abs(original.start.x - original.end.x) < 1e-6)
        expect(line.start.x).toBeCloseTo(original.start.x)
      else expect(line.start.y).toBeCloseTo(original.start.y)
    }
    assertEnclosed(after, 1)
    expect(lockOutsideFaces(after, { levelId }).changes).toEqual([])
  })
  test('moving a sub-room copies its shared separator and preserves both enclosed room IDs', () => {
    const { nodes, zoneId, mintId } = fixture()
    const divided = reconcile(
      nodes,
      divideZone(nodes, {
        zoneId,
        cut: [
          [2, 0],
          [2, 4],
        ],
        mintId,
      }),
    )
    const room = rooms(divided).find((room) => Math.max(...room.polygon.map((p) => p[0])) <= 2)!
    const separator = Object.values(divided).find((node) => node.type === 'separator')!
    const plan = transformZone(divided, { zoneId: room.id, translate: [-6, 0], mintId })
    const after = reconcile(divided, plan)
    expect(after[separator.id]).toEqual(divided[separator.id])
    expect(after[plan.idMap[separator.id]![0]!]).toMatchObject({ start: [-4, 0], end: [-4, 4] })
    expect(
      rooms(after)
        .map((room) => room.id)
        .sort(),
    ).toEqual(
      rooms(divided)
        .map((room) => room.id)
        .sort(),
    )
    assertEnclosed(after, 2)
    expect(roomFace(after, after[room.id] as ZoneNode)).toBeDefined()
    expect(walls(after).some((wall) => wall.start[0] >= 2 && wall.end[0] >= 2)).toBe(true)
  })
  test('duplicate copies openings, nested wall items and ceiling fixtures without copying derived hosts', () => {
    const { nodes, zoneId, mintId } = fixture()
    const wall = walls(nodes)[0]!
    const ceiling = Object.values(nodes).find((node) => node.type === 'ceiling')!
    const mounted = ItemNode.parse({
      id: 'item_mounted',
      parentId: wall.id,
      wallId: wall.id,
      wallT: 0.25,
      position: [1, 1, 0.2],
      children: ['item_mounted_child'],
      asset,
    })
    const child = ItemNode.parse({
      id: 'item_mounted_child',
      parentId: mounted.id,
      position: [0, 0.5, 0],
      asset,
    })
    const light = ItemNode.parse({
      id: 'item_light',
      parentId: ceiling.id,
      position: [2, -0.1, 2],
      asset,
    })
    const withDoor = door(nodes, wall, 'door_copy')
    const graph = { ...withDoor, [mounted.id]: mounted, [child.id]: child, [light.id]: light }
    const plan = duplicateZone(graph, { zoneId, translate: [6, 0], mintId })
    const after = reconcile(graph, plan)
    expect(plan.idMap[ceiling.id]).toBeUndefined()
    const copiedWall = plan.idMap[wall.id]![0]!
    expect(after[plan.idMap['door_copy']![0]!]).toMatchObject({
      parentId: copiedWall,
      wallId: copiedWall,
      position: [2, 0, 0],
    })
    expect(after[plan.idMap[mounted.id]![0]!]).toMatchObject({
      parentId: copiedWall,
      wallId: copiedWall,
      position: mounted.position,
    })
    expect(after[plan.idMap[child.id]![0]!]).toMatchObject({
      parentId: plan.idMap[mounted.id]![0],
      position: child.position,
    })
    expect(after[plan.idMap[light.id]![0]!]).toMatchObject({
      parentId: Object.values(after).find(
        (node) => node.type === 'ceiling' && node.zoneId === plan.zoneId,
      )!.id,
      position: [8, -0.1, 2],
    })
  })
  test('drop preserves the moving face finish and remaps overrides when the destination runs backwards', () => {
    const { nodes, zoneId, mintId } = fixture()
    const adjacent = addRoom(nodes, mintId, rectangle(10))
    const placed = walls(adjacent.nodes).find((wall) => wall.start[0] === 4 && wall.end[0] === 4)!
    const destination = walls(adjacent.nodes).find(
      (wall) => wall.start[0] === 10 && wall.end[0] === 10,
    )!
    const graph = {
      ...adjacent.nodes,
      [placed.id]: { ...placed, slots: { a: 'scene:red' } },
      [destination.id]: { ...destination, slots: { a: 'scene:blue' } },
    }
    const after = reconcile(graph, transformZone(graph, { zoneId, translate: [6, 0], mintId }))
    expect(after[destination.id]).toMatchObject({ slots: { a: 'scene:blue' } })
    expect((after[zoneId] as ZoneNode).wallOverrides).toContainEqual({
      wallId: destination.id,
      face: 'b',
      finish: 'scene:red',
    })
  })
  test('a room dropped inside another creates a ring and preserves the containing room ID', () => {
    const { nodes, zoneId, mintId } = fixture()
    const outside = addRoom(nodes, mintId, rectangle(10, -2, 10, 10))
    const plan = transformZone(outside.nodes, { zoneId, translate: [12, 0], mintId })
    expect(plan.conflicts).toBeUndefined()
    const after = reconcile(outside.nodes, plan)
    assertEnclosed(after, 2)
    expect((after[outside.zoneId] as ZoneNode).holes).toHaveLength(1)
    expect(after[zoneId]).toMatchObject({ seed: [14, 2] })
  })
  test('rotating curved boundaries keeps their arc and hosted stations', () => {
    const { nodes, zoneId, mintId } = fixture()
    const wall = walls(nodes)[0]!
    const curved = reconcile(nodes, {
      changes: [{ op: 'update', id: wall.id, data: { curveOffset: -1 } }],
    })
    const graph = door(curved, curved[wall.id] as WallNode, 'door_curved', 1.2)
    const plan = duplicateZone(graph, {
      zoneId,
      translate: [8, 0],
      rotate: { angle: Math.PI / 2 },
      mintId,
    })
    const after = reconcile(graph, plan)
    expect((after[plan.idMap[wall.id]![0]!] as WallNode).curveOffset).toBeCloseTo(-1)
    expect(after[plan.idMap['door_curved']![0]!]).toMatchObject({ position: [1.2, 0, 0] })
    assertEnclosed(after, 2)
  })
  test('invalid transforms and colliding minted IDs fail before producing a plan', () => {
    const { nodes, zoneId, mintId } = fixture()
    const before = JSON.stringify(nodes)
    expect(() => transformZone(nodes, { zoneId, translate: [Number.NaN, 0], mintId })).toThrow(
      'finite',
    )
    expect(() =>
      duplicateZone(nodes, { zoneId, translate: [6, 0], mintId: () => walls(nodes)[0]!.id }),
    ).toThrow('reused')
    expect(JSON.stringify(nodes)).toBe(before)
  })
  test('duplicate touching the source keeps its enclosure and merges the common wall', () => {
    const { nodes, zoneId, mintId } = fixture()
    const sourceWall = walls(nodes).find((wall) => wall.start[0] === 4 && wall.end[0] === 4)!
    const graph = door(nodes, sourceWall, 'door_source')
    const plan = duplicateZone(graph, { zoneId, translate: [4, 0], mintId })
    const after = reconcile(graph, plan)
    expect(after[zoneId]).toMatchObject({ polygon: (graph[zoneId] as ZoneNode).polygon })
    expect(after[sourceWall.id]).toMatchObject({ start: sourceWall.start, end: sourceWall.end })
    expect(after['door_source']).toEqual(graph['door_source'])
    expect(walls(after)).toHaveLength(7)
    assertEnclosed(after, 2)
  })
})

describe('room transform adversarial regressions', () => {
  test('fixed reference locking preserves curved separator junctions without conflicts', () => {
    const { nodes, zoneId, mintId } = fixture()
    const bottom = walls(nodes).find((wall) => wall.start[1] === 0 && wall.end[1] === 0)!
    const curved = reconcile(nodes, {
      changes: [{ op: 'update', id: bottom.id, data: { curveOffset: 1 } }],
    })
    const graph = reconcile(
      curved,
      divideZone(curved, {
        zoneId,
        cut: [
          [2, -1],
          [2, 4],
        ],
        startBoundaryId: bottom.id,
        mintId,
      }),
    )
    expect(rooms(graph)).toHaveLength(2)
    mount(graph)
    const plan = lockOutsideFaces(graph, { levelId })
    expect(plan.conflicts).toBeUndefined()
    expect(plan.wallIds).toHaveLength(4)
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    const after = useScene.getState().nodes
    expect(
      rooms(after)
        .map((zone) => zone.id)
        .sort(),
    ).toEqual(
      rooms(graph)
        .map((zone) => zone.id)
        .sort(),
    )
    for (const node of Object.values(graph))
      if (node.type === 'wall' || node.type === 'separator')
        expect(after[node.id]).toMatchObject({ start: node.start, end: node.end })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  for (const withWall of [false, true])
    test(`H1 outside-face locking preserves divided house IDs and intent (T wall=${withWall})`, () => {
      const { nodes, zoneId, mintId } = fixture()
      let graph = reconcile(
        nodes,
        divideZone(nodes, {
          zoneId,
          cut: [
            [2, 0],
            [2, 4],
          ],
          mintId,
        }),
      )
      if (withWall) {
        const wall = WallNode.parse({
          id: 'wall_tstem',
          parentId: levelId,
          start: [3, 0],
          end: [3, 4],
          thickness: 0.2,
        })
        graph = reconcile(graph, { changes: [{ op: 'create', node: wall }] })
      }
      for (const zone of rooms(graph))
        graph[zone.id] = {
          ...zone,
          name: `Saved ${zone.id}`,
          floor: { finish: `scene:${zone.id}` },
        }
      mount(graph)
      const before = useScene.getState().nodes
      const plan = lockOutsideFaces(before, { levelId })
      expect(plan.conflicts).toBeUndefined()
      useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
      const after = useScene.getState().nodes
      assertEnclosed(after, withWall ? 3 : 2)
      expect(
        rooms(after)
          .map((zone) => zone.id)
          .sort(),
      ).toEqual(
        rooms(before)
          .map((zone) => zone.id)
          .sort(),
      )
      for (const zone of rooms(before))
        expect(after[zone.id]).toMatchObject({ name: zone.name, floor: zone.floor })
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(before)
    })

  test('H2 shared separator move preserves both rooms in one store history step', () => {
    const { nodes, zoneId, mintId } = fixture()
    const graph = reconcile(
      nodes,
      divideZone(nodes, {
        zoneId,
        cut: [
          [2, 0],
          [2, 4],
        ],
        mintId,
      }),
    )
    const left = rooms(graph).find((zone) => Math.max(...zone.polygon.map((p) => p[0])) <= 2)!
    mount(graph)
    applyZoneTransformPlan(transformZone(graph, { zoneId: left.id, translate: [-6, 0], mintId }))
    const after = useScene.getState().nodes
    assertEnclosed(after, 2)
    expect(
      rooms(after)
        .map((zone) => zone.id)
        .sort(),
    ).toEqual(
      rooms(graph)
        .map((zone) => zone.id)
        .sort(),
    )
    expect(Object.values(after).filter((node) => node.type === 'separator')).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('H3 pickup includes furnishings within the wall envelope and excludes exterior items and non-furnishing kinds', () => {
    const { nodes, zoneId, mintId } = fixture()
    const furnishings = [
      ItemNode.parse({ id: 'item_inside', parentId: levelId, position: [1, 0, 1], asset }),
      ItemNode.parse({ id: 'item_boundary', parentId: levelId, position: [0.01, 0, 2], asset }),
      CabinetNode.parse({ id: 'cabinet_inside', parentId: levelId, position: [2, 0, 2] }),
      ShelfNode.parse({ id: 'shelf_inside', parentId: levelId, position: [3, 0, 2] }),
      StairNode.parse({ id: 'stair_inside', parentId: levelId, position: [3, 0, 3] }),
    ]
    const excluded = [
      ItemNode.parse({ id: 'item_outside', parentId: levelId, position: [-0.4, 0, 2], asset }),
      RoofNode.parse({ id: 'roof_unchanged', parentId: levelId, position: [2, 0, 2] }),
      RoofSegmentNode.parse({ id: 'rseg_unchanged', parentId: levelId, position: [2, 0, 2] }),
      GuideNode.parse({
        id: 'guide_unchanged',
        parentId: levelId,
        position: [2, 0, 2],
        url: 'https://example.com/guide.png',
      }),
      ScanNode.parse({ id: 'scan_unchanged', parentId: levelId, position: [2, 0, 2] }),
      SpawnNode.parse({ id: 'spawn_unchanged', parentId: levelId, position: [2, 0, 2] }),
      MeasurementNode.parse({
        id: 'measurement_unchanged',
        parentId: levelId,
        measurement: {
          kind: 'distance',
          points: [
            [1, 0, 1],
            [2, 0, 1],
          ],
        },
      }),
      ConstructionDimensionNode.parse({
        id: 'construction-dimension_unchanged',
        parentId: levelId,
      }),
    ]
    const graph = {
      ...nodes,
      ...Object.fromEntries([...furnishings, ...excluded].map((node) => [node.id, node])),
    }
    const plan = transformZone(graph, { zoneId, translate: [10, 0], mintId })
    mount(graph)
    applyZoneTransformPlan(plan)
    const after = useScene.getState().nodes
    for (const node of excluded) expect(after[node.id]).toEqual(node)
    for (const node of furnishings)
      expect(after[node.id]).toMatchObject({
        position: [node.position[0] + 10, node.position[1], node.position[2]],
      })
  })

  test('M4 an unsplit partly shared T wall keeps the shared door and moves its unshared door', () => {
    const { mintId } = fixture()
    const initial = {
      [levelId]: LevelNode.parse({ id: levelId, parentId: 'building_transform' }),
      building_transform: BuildingNode.parse({ id: 'building_transform', children: [levelId] }),
    }
    const segments: Array<[[number, number], [number, number]]> = [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [4, 4],
      ],
      [
        [4, 4],
        [0, 4],
      ],
      [
        [0, 4],
        [0, 0],
      ],
      [
        [4, 0],
        [8, 0],
      ],
      [
        [8, 0],
        [8, 2],
      ],
      [
        [8, 2],
        [4, 2],
      ],
    ]
    let graph = reconcile(initial, {
      changes: segments.map(([start, end], i) => ({
        op: 'create',
        node: WallNode.parse({ id: `wall_partial${i}`, parentId: levelId, start, end }),
      })),
    })
    const room = rooms(graph).find((zone) => zone.polygon.some((p) => p[0] < 1))!
    const wall = graph.wall_partial1 as WallNode
    graph = door(graph, wall, 'door_shared_lower', 1)
    graph = door(graph, graph[wall.id] as WallNode, 'door_unshared_upper', 3)
    mount(graph)
    const plan = transformZone(graph, { zoneId: room.id, translate: [-10, 0], mintId })
    expect(plan.conflicts).toBeUndefined()
    applyZoneTransformPlan(plan)
    const after = useScene.getState().nodes
    const childPosition = (id: string) => {
      const child = after[id] as ReturnType<typeof DoorNode.parse>
      const host = after[child.parentId!] as WallNode
      const t =
        child.position[0] / Math.hypot(host.end[0] - host.start[0], host.end[1] - host.start[1])
      return [
        host.start[0] + t * (host.end[0] - host.start[0]),
        host.start[1] + t * (host.end[1] - host.start[1]),
      ]
    }
    expect(childPosition('door_shared_lower')).toEqual([4, 1])
    expect(childPosition('door_unshared_upper')).toEqual([-6, 3])
    expect(after[wall.id]).toMatchObject({ start: [4, 0], end: [4, 2] })
    assertEnclosed(after, 2)
    expect(
      rooms(after)
        .map((zone) => zone.id)
        .sort(),
    ).toEqual(
      rooms(graph)
        .map((zone) => zone.id)
        .sort(),
    )
  })

  for (const offset of [0.001, -0.05, 0.099])
    test(`M5 drop snaps a ${offset} m offset onto the destination line and keeps rooms enclosed`, () => {
      const { nodes, zoneId, mintId } = fixture()
      const other = addRoom(nodes, mintId, rectangle(10))
      const destination = walls(other.nodes).find(
        (wall) => wall.start[0] === 10 && wall.end[0] === 10,
      )!
      const plan = transformZone(other.nodes, { zoneId, translate: [6 + offset, 0], mintId })
      const after = reconcile(other.nodes, plan)
      expect(walls(after)).toHaveLength(7)
      expect(after[destination.id]).toMatchObject({
        start: destination.start,
        end: destination.end,
      })
      assertEnclosed(after, 2)
    })

  test('close parallel wall bodies outside merge tolerance remain valid separate walls', () => {
    const { nodes, zoneId, mintId } = fixture()
    const long = WallNode.parse({
      id: 'wall_parallel',
      parentId: levelId,
      start: [10.15, 0],
      end: [10.15, 4],
      thickness: 0.4,
    })
    const graph = { ...nodes, [long.id]: long }
    const blocked = transformZone(graph, { zoneId, translate: [6, 0], mintId })
    expect(blocked.conflicts).toBeUndefined()
    expect(blocked.changes.length).toBeGreaterThan(0)
    const forced = transformZone(graph, { zoneId, translate: [6, 0], force: true, mintId })
    expect(forced.changes.length).toBeGreaterThan(0)
    const short = {
      ...long,
      start: [10, 3.95] as [number, number],
      end: [10, 5] as [number, number],
    }
    const partial = transformZone(
      { ...nodes, [short.id]: short },
      { zoneId, translate: [6, 0], mintId },
    )
    expect(partial.conflicts).toBeUndefined()
    expect(partial.changes.length).toBeGreaterThan(0)
    const after = reconcile({ ...nodes, [short.id]: short }, partial)
    expectNoDuplicateBoundaries(after)
    expect(after[short.id]).toBeDefined()
  })

  test('M6 moving or copying an intact painted wall does not freeze its finish in room overrides', () => {
    const { nodes, zoneId, mintId } = fixture()
    const wall = walls(nodes)[0]!
    const graph = { ...nodes, [wall.id]: { ...wall, slots: { a: 'scene:red' } } }
    for (const planner of [transformZone, duplicateZone]) {
      const plan = planner(graph, { zoneId, translate: [10, 0], mintId })
      const after = reconcile(graph, plan)
      expect((after[plan.zoneId] as ZoneNode).wallOverrides).toBeUndefined()
      expect(after[plan.idMap[wall.id]![0]!]).toMatchObject({ slots: { a: 'scene:red' } })
    }
  })

  test('L7 duplicates take the next free numbered name without renaming their source', () => {
    const { nodes, zoneId, mintId } = fixture()
    const first = duplicateZone(nodes, { zoneId, translate: [6, 0], mintId })
    const graph = reconcile(nodes, first)
    expect(graph[first.zoneId]).toMatchObject({ name: 'Kitchen 2' })
    const second = duplicateZone(graph, { zoneId: first.zoneId, translate: [6, 0], mintId })
    expect(reconcile(graph, second)[second.zoneId]).toMatchObject({ name: 'Kitchen 3' })
    expect(graph[zoneId]).toMatchObject({ name: 'Kitchen' })
  })

  test('L8 copied ceiling fixtures are rehosted to the derived copy ceiling in one undoable commit', () => {
    const { nodes, zoneId, mintId } = fixture()
    const ceiling = Object.values(nodes).find((node) => node.type === 'ceiling')!
    const light = ItemNode.parse({
      id: 'item_hosted_copy',
      parentId: ceiling.id,
      position: [2, -0.1, 2],
      asset,
    })
    const graph = {
      ...nodes,
      [light.id]: light,
      [ceiling.id]: { ...ceiling, children: [light.id] },
    }
    mount(graph)
    const plan = duplicateZone(graph, { zoneId, translate: [6, 0], mintId })
    expect(
      plan.changes.some((change) => change.op === 'create' && isDerivedNode(change.node)),
    ).toBe(false)
    const commits: string[] = []
    const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit.origin))
    try {
      applyZoneTransformPlan(plan)
    } finally {
      unsubscribe()
    }
    expect(commits).toHaveLength(1)
    const after = useScene.getState().nodes
    const newCeiling = Object.values(after).find(
      (node) => node.type === 'ceiling' && node.zoneId === plan.zoneId,
    )!
    const copiedId = plan.idMap[light.id]![0]!
    expect(after[copiedId]).toMatchObject({ parentId: newCeiling.id, position: [8, -0.1, 2] })
    expect(newCeiling.children).toContain(copiedId)
    expect(after[light.id]).toEqual(light)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(graph)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(after)
  })

  for (const movingSeparator of [false, true])
    test(`L9 boundary crossing includes separators (moving=${movingSeparator})`, () => {
      const { nodes, zoneId, mintId } = fixture()
      let graph = nodes
      if (movingSeparator) {
        const wall = walls(nodes)[0]!
        const separator = SeparatorNode.parse({
          id: 'separator_moving',
          parentId: levelId,
          start: wall.start,
          end: wall.end,
        })
        graph = reconcile(nodes, {
          changes: [
            { op: 'delete', id: wall.id },
            { op: 'create', node: separator },
          ],
        })
      }
      const obstruction = movingSeparator
        ? WallNode.parse({ id: 'wall_crossing', parentId: levelId, start: [8, -1], end: [8, 1] })
        : SeparatorNode.parse({
            id: 'separator_crossing',
            parentId: levelId,
            start: [8, -1],
            end: [8, 1],
          })
      const plan = transformZone(
        { ...graph, [obstruction.id]: obstruction },
        { zoneId, translate: [6, 0], mintId },
      )
      expect(plan.conflicts).toBeUndefined()
      const after = reconcile({ ...graph, [obstruction.id]: obstruction }, plan)
      assertEnclosed(after, 1)
      expect(
        Object.values(after).filter(
          (node) =>
            (node.type === 'wall' || node.type === 'separator') &&
            [node.start, node.end].some((point) => point[0] === 8 && point[1] === 0),
        ),
      ).toHaveLength(4)
    })

  test('L10 a stair on another level using the moved deck conflicts unless forced', () => {
    const { nodes, zoneId, mintId } = fixture()
    const plate = Object.values(nodes).find((node) => node.type === 'slab')!
    const lower = LevelNode.parse({ id: 'level_lower', parentId: 'building_transform', level: -1 })
    const stair = StairNode.parse({
      id: 'stair_lower',
      parentId: lower.id,
      position: [1, 0, 1],
      deckSlabId: plate.id,
    })
    const graph = { ...nodes, [lower.id]: lower, [stair.id]: stair }
    const plan = transformZone(graph, { zoneId, translate: [6, 0], mintId })
    expect(plan.changes).toEqual([])
    expect(plan.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'deck-reference', nodeIds: [stair.id, plate.id] }),
      ]),
    )
    const forced = transformZone(graph, { zoneId, translate: [6, 0], force: true, mintId })
    expect(forced.changes.length).toBeGreaterThan(0)
    expect(forced.conflicts?.map((entry) => entry.code)).toContain('deck-reference')
    expect(duplicateZone(graph, { zoneId, translate: [6, 0], mintId }).conflicts).toBeUndefined()
  })

  test('H3 procedural furnishings move and duplicate using the same room containment', () => {
    const { nodes, zoneId, mintId } = fixture()
    const inside = ProceduralItemNode.parse({
      id: 'procedural-item_inside',
      parentId: levelId,
      position: [1, 0, 1],
      recipe: shelfRecipe,
    })
    const outside = ProceduralItemNode.parse({
      id: 'procedural-item_outside',
      parentId: levelId,
      position: [-0.4, 0, 1],
      recipe: shelfRecipe,
    })
    const graph = {
      ...nodes,
      [inside.id]: inside,
      [outside.id]: outside,
    } as unknown as StructureNodes
    for (const planner of [transformZone, duplicateZone]) {
      const plan = planner(graph, { zoneId, translate: [6, 0], mintId })
      expect(plan.conflicts).toBeUndefined()
      const after = applyToScratch(graph, structureChangeBatch(plan.changes))
      expect(after[plan.idMap[inside.id]![0]!]).toMatchObject({ position: [7, 0, 1] })
      expect(after[outside.id]).toEqual(outside as never)
      expect(plan.idMap[outside.id]).toBeUndefined()
    }
  })
})

describe('Sims room placement', () => {
  test('quarter-turn beside a neighbour merges collinear walls in one undo step', () => {
    const base = fixture()
    const source = reconcile(
      base.nodes,
      transformZone(base.nodes, { zoneId: base.zoneId, translate: [-20, 0], mintId: base.mintId }),
    )
    const room = addRoom(source, base.mintId, rectangle(0, 0, 2, 4))
    const neighbour = addRoom(room.nodes, base.mintId, rectangle(3, 1, 4, 2))
    const destination = walls(neighbour.nodes).find(
      (wall) => wall.start[0] === 3 && wall.end[0] === 3,
    )!
    mount(neighbour.nodes)
    const plan = rotateZone(neighbour.nodes, {
      zoneId: room.zoneId,
      quarterTurns: 1,
      mintId: base.mintId,
    })
    expect(plan.conflicts).toBeUndefined()
    applyZoneTransformPlan(plan)
    const after = useScene.getState().nodes
    assertEnclosed(after, 3)
    expect(walls(after)).toHaveLength(11)
    expect(after[destination.id]).toBeDefined()
    expect(after[room.zoneId]).toBeDefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(neighbour.nodes)
  })

  for (const quarterTurns of [-1, 1] as const)
    for (const gridStep of [0.5, 0.25])
      test(`quarter-turn snaps the first reference vertex and keeps all grid vertices (${quarterTurns}, ${gridStep})`, () => {
        const { nodes, mintId } = fixture()
        const room = addRoom(nodes, mintId, rectangle(10, 0, 5 * gridStep, 8 * gridStep))
        const plan = rotateZone(room.nodes, {
          zoneId: room.zoneId,
          quarterTurns,
          ...(gridStep === 0.25 ? { gridStep } : {}),
          mintId,
        })
        const after = reconcile(room.nodes, plan)
        const zone = after[room.zoneId] as ZoneNode
        for (const id of zone.boundaryWallIds) {
          const wall = after[id] as WallNode
          for (const point of [wall.start, wall.end])
            for (const value of point) expect(value / gridStep).toBe(Math.round(value / gridStep))
        }
        assertEnclosed(after, 2)
      })

  test('coincident enclosures merge and the larger overlap retains its zone ID', () => {
    const { nodes, zoneId, mintId } = fixture()
    const source = addRoom(nodes, mintId, rectangle(8, 0, 3.9, 3.9))
    mount(source.nodes)
    const plan = transformZone(source.nodes, {
      zoneId: source.zoneId,
      translate: [-7.95, 0.05],
      mintId,
    })
    expect(plan.conflicts).toBeUndefined()
    applyZoneTransformPlan(plan)
    const after = useScene.getState().nodes
    assertEnclosed(after, 1)
    expect(rooms(after).map((zone) => zone.id)).toEqual([zoneId])
    expect(walls(after)).toHaveLength(4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  for (const sourceOpening of [false, true])
    for (const kind of ['door', 'window'] as const)
      test(`crossing inside an opening refuses; force relocates it on its wall (moving=${sourceOpening}, ${kind})`, () => {
        const { nodes, zoneId, mintId } = fixture()
        const neighbour = addRoom(nodes, mintId, rectangle(8))
        const host = sourceOpening
          ? walls(neighbour.nodes).find(
              (wall) => wall.start[1] === 0 && wall.end[1] === 0 && wall.start[0] === 0,
            )!
          : walls(neighbour.nodes).find((wall) => wall.start[0] === 12 && wall.end[0] === 12)!
        const attached = (kind === 'door' ? DoorNode : WindowNode).parse({
          id: `${kind}_crossing`,
          parentId: host.id,
          wallId: host.id,
          position: [sourceOpening ? 3 : 1, 0, 0],
        })
        const graph = {
          ...neighbour.nodes,
          [host.id]: { ...host, children: [attached.id] },
          [attached.id]: attached,
        }
        const before = JSON.stringify(graph)
        const blocked = transformZone(graph, { zoneId, translate: [9, 1], mintId })
        expect(blocked.changes).toEqual([])
        expect(blocked.conflicts?.map((entry) => entry.code)).toEqual(['occupied-split'])
        const forced = transformZone(graph, { zoneId, translate: [9, 1], force: true, mintId })
        expect(forced.conflicts).toBeUndefined()
        const after = reconcile(graph, forced)
        const opening = after[attached.id] as DoorNode | WindowNode
        const wall = after[opening.parentId!] as WallNode
        expect(opening.position[0]).toBeGreaterThanOrEqual(opening.width / 2)
        expect(opening.position[0] + opening.width / 2).toBeLessThanOrEqual(
          Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) + 1e-6,
        )
        expect(JSON.stringify(graph)).toBe(before)
        assertEnclosed(after, 3)
      })

  test('force still refuses an opening that cannot fit between crossings', () => {
    const { nodes, zoneId, mintId } = fixture()
    const neighbour = addRoom(nodes, mintId, rectangle(8))
    const host = walls(neighbour.nodes).find(
      (wall) => wall.start[1] === 0 && wall.end[1] === 0 && wall.start[0] === 0,
    )!
    const opening = DoorNode.parse({
      id: 'door_too_wide',
      parentId: host.id,
      wallId: host.id,
      position: [2, 0, 0],
      width: 3.5,
    })
    const graph = {
      ...neighbour.nodes,
      [opening.id]: opening,
      [host.id]: { ...host, children: [opening.id] },
    }
    const plan = transformZone(graph, { zoneId, translate: [9, 1], force: true, mintId })
    expect(plan.changes).toEqual([])
    expect(plan.conflicts?.map((entry) => entry.code)).toEqual(['occupied-split'])
  })

  test('force relocation clears every crossing and avoids an existing opening', () => {
    const { nodes, zoneId, mintId } = fixture()
    const host = walls(nodes)[0]!
    let graph = door(nodes, host, 'door_moved', 2)
    graph = door(graph, graph[host.id] as WallNode, 'door_fixed', 0.5)
    const blockers = [1.8, 2.2].map((x, i) =>
      WallNode.parse({
        id: `wall_obstruction${i}`,
        parentId: levelId,
        start: [x + 10, -1],
        end: [x + 10, 1],
      }),
    )
    graph = { ...graph, ...Object.fromEntries(blockers.map((wall) => [wall.id, wall])) }
    const plan = transformZone(graph, { zoneId, translate: [10, 0], force: true, mintId })
    expect(plan.conflicts).toBeUndefined()
    const after = reconcile(graph, plan)
    const moved = after['door_moved'] as DoorNode,
      fixed = after['door_fixed'] as DoorNode
    expect(fixed.position).toEqual([0.5, 0, 0])
    expect(moved.parentId).not.toBe(fixed.parentId)
    const parent = after[moved.parentId!] as WallNode
    expect(parent.start[0] + moved.position[0] - moved.width / 2).toBeGreaterThanOrEqual(12.2)
  })

  test('duplicating onto another enclosure keeps both sets of openings and rehosts ceiling fixtures', () => {
    const { nodes, zoneId, mintId } = fixture()
    const destination = addRoom(nodes, mintId, rectangle(6))
    const sourceWall = walls(destination.nodes).find(
      (wall) => wall.start[0] === 0 && wall.start[1] === 0 && wall.end[1] === 0,
    )!
    const destinationWall = walls(destination.nodes).find(
      (wall) => wall.start[0] === 6 && wall.start[1] === 0 && wall.end[1] === 0,
    )!
    const withSourceDoor = door(destination.nodes, sourceWall, 'door_copy_source', 1)
    const withDoors = door(withSourceDoor, destinationWall, 'door_copy_destination', 3)
    const ceiling = Object.values(destination.nodes).find(
      (node) => node.type === 'ceiling' && node.zoneId === zoneId,
    )!
    const light = ItemNode.parse({
      id: 'item_merge_light',
      parentId: ceiling.id,
      position: [2, -0.1, 2],
      asset,
    })
    const graph = {
      ...withDoors,
      [light.id]: light,
      [ceiling.id]: { ...ceiling, children: [light.id] },
    }
    const plan = duplicateZone(graph, { zoneId, translate: [6, 0], mintId })
    expect(plan.conflicts).toBeUndefined()
    const after = reconcile(graph, plan)
    assertEnclosed(after, 2)
    const copied = after[plan.idMap[light.id]![0]!]!
    expect(after[copied.parentId!]?.type).toBe('ceiling')
    expect(copied).toMatchObject({ position: [8, -0.1, 2] })
    expect(after[light.id]).toEqual(light)
    expect(after[plan.idMap.door_copy_source![0]!]).toMatchObject({
      parentId: destinationWall.id,
      position: [1, 0, 0],
    })
    expect(after.door_copy_destination).toMatchObject({
      parentId: destinationWall.id,
      position: [3, 0, 0],
    })
    expect(after.door_copy_source).toEqual(graph.door_copy_source)
  })
})

for (const curvedDestination of [false, true])
  test(`dropping curved boundaries splits exact crossings (curved destination=${curvedDestination})`, () => {
    const { nodes, zoneId, mintId } = fixture()
    const bottom = walls(nodes).find((wall) => wall.start[1] === 0 && wall.end[1] === 0)!
    const source = reconcile(nodes, {
      changes: [{ op: 'update', id: bottom.id, data: { curveOffset: 1 } }],
    })
    const obstacle = WallNode.parse({
      id: 'wall_arc_crossing',
      parentId: levelId,
      start: curvedDestination ? [10, -1] : [12, -2],
      end: curvedDestination ? [14, -1] : [12, 1],
      ...(curvedDestination ? { curveOffset: -1 } : {}),
    })
    const graph = { ...source, [obstacle.id]: obstacle }
    const plan = transformZone(graph, { zoneId, translate: [10, 0], mintId })
    expect(plan.conflicts).toBeUndefined()
    const after = reconcile(graph, plan)
    expect(walls(after).filter((wall) => wall.curveOffset)).toHaveLength(curvedDestination ? 6 : 2)
    expect(after[zoneId]).toBeDefined()
    expect(rooms(after).every((zone) => zone.enclosureStatus === 'enclosed')).toBe(true)
    const cuts = new Map<string, number>()
    for (const wall of walls(after))
      for (const [x, z] of [wall.start, wall.end]) {
        const key = `${x.toFixed(6)},${z.toFixed(6)}`
        cuts.set(key, (cuts.get(key) ?? 0) + 1)
      }
    expect([...cuts.values()].filter((count) => count === 4)).toHaveLength(
      curvedDestination ? 2 : 1,
    )
  })

describe('Sims audit regressions', () => {
  for (const dx of [9, 11])
    test(`partial duplicate retains Kitchen 2 and Bedroom on their largest owned faces (${dx})`, () => {
      const { nodes, zoneId, mintId } = fixture()
      const neighbour = addRoom(nodes, mintId, rectangle(8))
      const graph = {
        ...neighbour.nodes,
        [neighbour.zoneId]: {
          ...neighbour.nodes[neighbour.zoneId],
          name: 'Bedroom',
          floor: { finish: 'tile' },
        },
        [zoneId]: { ...neighbour.nodes[zoneId], floor: { finish: 'wood' } },
      } as StructureNodes
      mount(graph)
      const plan = duplicateZone(graph, { zoneId, translate: [dx, 1], mintId })
      applyZoneTransformPlan(plan)
      const after = useScene.getState().nodes
      assertEnclosed(after, 4)
      expect(after[zoneId]).toEqual(graph[zoneId])
      expect(after[plan.zoneId]).toMatchObject({ name: 'Kitchen 2', floor: { finish: 'wood' } })
      expect(after[neighbour.zoneId]).toMatchObject({ name: 'Bedroom', floor: { finish: 'tile' } })
      const copy = after[plan.zoneId] as ZoneNode
      expect(area([{ outer: copy.polygon, holes: copy.holes }])).toBeCloseTo(dx === 9 ? 9 : 13)
      const bedroom = after[neighbour.zoneId] as ZoneNode
      expect(containsPoint([{ outer: rectangle(dx, 1), holes: [] }], bedroom.seed!)).toBe(false)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(graph)
    })

  for (const overlap of [0.05, 0.005])
    test(`short collinear overlaps merge duplicate pieces and keep children on both sides (${overlap})`, () => {
      const { nodes, zoneId, mintId } = fixture()
      const source = walls(nodes).find((wall) => wall.start[0] === 4 && wall.end[0] === 4)!
      const destination = WallNode.parse({
        id: 'wall_short_destination',
        parentId: levelId,
        start: [10, 4 - overlap],
        end: [10, 5],
      })
      const child = ItemNode.parse({
        id: 'item_short_source',
        parentId: source.id,
        position: [4 - overlap / 2, 1, 0],
        asset,
      })
      const other = ItemNode.parse({
        id: 'item_short_destination',
        parentId: destination.id,
        position: [overlap / 2, 1, 0],
        asset,
      })
      const graph = {
        ...nodes,
        [source.id]: { ...source, children: [child.id] },
        [destination.id]: { ...destination, children: [other.id] },
        [child.id]: child,
        [other.id]: other,
      }
      const plan = transformZone(graph, { zoneId, translate: [6, 0], mintId })
      const after = reconcile(graph, plan)
      expectNoDuplicateBoundaries(after)
      expect(after[destination.id]).toBeDefined()
      expect(after[child.id]).toMatchObject({ parentId: destination.id })
      expect(after[other.id]).toMatchObject({ parentId: destination.id })
      expect((after[child.id] as ItemNode).position[0]).toBeCloseTo(overlap / 2)
      expect((after[other.id] as ItemNode).position[0]).toBeCloseTo(overlap / 2)
      assertEnclosed(after, 1)
    })

  test('merging the first short piece retains the full source ID map', () => {
    const { nodes, zoneId, mintId } = fixture()
    const source = walls(nodes).find((wall) => wall.start[0] === 4 && wall.end[0] === 4)!
    const destination = WallNode.parse({
      id: 'wall_short_start',
      parentId: levelId,
      start: [10, 0.05],
      end: [10, -1],
    })
    const graph = { ...nodes, [destination.id]: destination }
    const plan = transformZone(graph, { zoneId, translate: [6, 0], mintId })
    const after = reconcile(graph, plan)
    expectNoDuplicateBoundaries(after)
    const mapped = plan.idMap[source.id]!
    expect(mapped).toHaveLength(2)
    expect(mapped).toContain(destination.id)
    const length = mapped.reduce((sum, id) => {
      const wall = after[id] as WallNode
      return sum + Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    }, 0)
    expect(length).toBeCloseTo(4)
  })

  test('a stationary wall replaces the covered middle of a moving separator', () => {
    const { nodes, zoneId, mintId } = fixture()
    const bottom = walls(nodes)[0]!
    const separator = SeparatorNode.parse({
      id: 'separator_covered',
      parentId: levelId,
      start: bottom.start,
      end: bottom.end,
    })
    const source = reconcile(nodes, {
      changes: [
        { op: 'delete', id: bottom.id },
        { op: 'create', node: separator },
      ],
    })
    const wall = WallNode.parse({
      id: 'wall_covering_separator',
      parentId: levelId,
      start: [11, 0],
      end: [13, 0],
    })
    const graph = { ...source, [wall.id]: wall }
    const plan = transformZone(graph, { zoneId, translate: [10, 0], mintId })
    const after = reconcile(graph, plan)
    expectNoDuplicateBoundaries(after)
    const tails = Object.values(after).filter((node) => node.type === 'separator')
    expect(tails).toHaveLength(2)
    expect(tails.map((node) => [node.start, node.end])).toEqual(
      expect.arrayContaining([
        [
          [10, 0],
          [11, 0],
        ],
        [
          [13, 0],
          [14, 0],
        ],
      ]),
    )
    expect(after[wall.id]).toMatchObject({ start: [11, 0], end: [13, 0] })
    expect((after[zoneId] as ZoneNode).boundaryWallIds).toContain(wall.id)
    assertEnclosed(after, 1)
  })

  test('curved room drops leave distant crossing walls byte-identical', () => {
    const { nodes, zoneId, mintId } = fixture()
    const bottom = walls(nodes)[0]!
    const curved = reconcile(nodes, {
      changes: [{ op: 'update', id: bottom.id, data: { curveOffset: 1 } }],
    })
    const distant = [
      WallNode.parse({
        id: 'wall_distant_horizontal',
        parentId: levelId,
        start: [40, 0],
        end: [44, 0],
      }),
      WallNode.parse({
        id: 'wall_distant_vertical',
        parentId: levelId,
        start: [42, -1],
        end: [42, 1],
      }),
    ]
    const graph = { ...curved, ...Object.fromEntries(distant.map((node) => [node.id, node])) }
    const plan = transformZone(graph, { zoneId, translate: [10, 0], mintId })
    const after = reconcile(graph, plan)
    for (const wall of distant) {
      expect(after[wall.id]).toEqual(wall)
      expect(plan.changes.some((change) => change.op !== 'create' && change.id === wall.id)).toBe(
        false,
      )
    }
    expect(walls(after)).toHaveLength(6)
  })

  for (const station of [2, 1.45])
    test(`opening clearance includes half the crossing wall thickness (${station})`, () => {
      const { nodes, zoneId, mintId } = fixture()
      const host = walls(nodes)[0]!
      let graph = door(nodes, host, 'door_padded', station)
      const crossing = WallNode.parse({
        id: 'wall_thick_crossing',
        parentId: levelId,
        start: [12, -1],
        end: [12, 1],
        thickness: 0.4,
      })
      graph = { ...graph, [crossing.id]: crossing }
      const blocked = transformZone(graph, { zoneId, translate: [10, 0], mintId })
      expect(blocked.changes).toEqual([])
      expect(blocked.conflicts?.map((conflict) => conflict.code)).toEqual(['occupied-split'])
      const forced = transformZone(graph, { zoneId, translate: [10, 0], force: true, mintId })
      const after = reconcile(graph, forced)
      const opening = after.door_padded as DoorNode
      const parent = after[opening.parentId!] as WallNode
      const x = parent.start[0] + opening.position[0]
      expect(Math.abs(x - 12) - opening.width / 2).toBeGreaterThanOrEqual(0.2 - 1e-6)
    })

  test('force refuses when crossing wall thickness consumes the remaining opening space', () => {
    const { nodes, zoneId, mintId } = fixture()
    const host = walls(nodes)[0]!
    const opening = DoorNode.parse({
      id: 'door_padding_no_fit',
      parentId: host.id,
      wallId: host.id,
      position: [2, 0, 0],
      width: 1.9,
    })
    const crossing = WallNode.parse({
      id: 'wall_padding_no_fit',
      parentId: levelId,
      start: [12, -1],
      end: [12, 1],
      thickness: 0.4,
    })
    const graph = {
      ...nodes,
      [host.id]: { ...host, children: [opening.id] },
      [opening.id]: opening,
      [crossing.id]: crossing,
    }
    const plan = transformZone(graph, { zoneId, translate: [10, 0], force: true, mintId })
    expect(plan.changes).toEqual([])
    expect(plan.conflicts?.map((conflict) => conflict.code)).toEqual(['occupied-split'])
  })

  test('an open room returns a structured conflict for move, duplicate and rotate', () => {
    const { nodes, zoneId, mintId } = fixture()
    const graph = { ...nodes }
    delete graph[walls(nodes)[0]!.id]
    for (const plan of [
      transformZone(graph, { zoneId, translate: [2, 0], mintId }),
      duplicateZone(graph, { zoneId, translate: [2, 0], mintId }),
      rotateZone(graph, { zoneId, quarterTurns: 1, mintId }),
    ]) {
      expect(plan.changes).toEqual([])
      expect(plan.conflicts?.map((conflict) => conflict.code)).toEqual(['open-room'])
      expect(plan.idMap).toEqual({})
    }
  })
})
