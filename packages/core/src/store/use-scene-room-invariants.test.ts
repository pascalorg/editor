import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  initSpaceDetectionSync,
  pauseSpaceDetection,
  resumeSpaceDetection,
  type Space,
} from '../lib/space-detection'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  ItemNode,
  LevelNode,
  SeparatorNode,
  SlabNode,
  StairNode,
  WallNode,
  type ZoneNode,
} from '../schema'
import { type SceneCommit, subscribeSceneCommits } from './history-control'
import useScene, {
  applySceneOperationPatch,
  clearSceneHistory,
  type SceneOperationPatch,
} from './use-scene'

const levelId = 'level_room_invariants'
const buildingId = 'building_room_invariants'
const polygon: Array<[number, number]> = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let previousState: ReturnType<typeof useScene.getState>
let stopDetection = () => {}
let stopCommits = () => {}

beforeEach(() => {
  previousState = useScene.getState()
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
})

afterEach(() => {
  stopCommits()
  stopDetection()
  useScene.setState(previousState, true)
  clearSceneHistory()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

function startDetection() {
  const editor = {
    spaces: {} as Record<string, Space>,
    setSpaces(spaces: Record<string, Space>) {
      this.spaces = spaces
    },
  }
  stopDetection = initSpaceDetectionSync(useScene, { getState: () => editor })
  return editor
}

function openRoom() {
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      id: `wall_room_invariants_${index}`,
      parentId: levelId,
      start,
      end: polygon[(index + 1) % 4],
      thickness: 0.2,
    }),
  )
  const initial = [
    BuildingNode.parse({ id: buildingId, children: [levelId] }),
    LevelNode.parse({
      id: levelId,
      parentId: buildingId,
      level: 0,
      height: 2.5,
      children: walls.slice(0, 3).map((wall) => wall.id),
    }),
    ...walls.slice(0, 3),
  ]
  useScene.setState({
    nodes: Object.fromEntries(initial.map((node) => [node.id, node])),
    rootNodeIds: [buildingId],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
  })
  clearSceneHistory()
  startDetection()
  return walls
}

function surfaces() {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is SlabNode | CeilingNode => node.type === 'slab' || node.type === 'ceiling',
  )
}

function rooms() {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is ZoneNode => node.type === 'zone',
  )
}

function closeRoom() {
  const walls = openRoom()
  useScene.getState().createNode(walls[3]!, levelId)
  expect(surfaces().filter((node) => node.type === 'slab')).toHaveLength(1)
  expect(surfaces().filter((node) => node.type === 'ceiling')).toHaveLength(1)
  return walls
}

function moveRightWall(x: number) {
  useScene.getState().updateNodes([
    { id: 'wall_room_invariants_0', data: { end: [x, 0] } },
    { id: 'wall_room_invariants_1', data: { start: [x, 0], end: [x, 4] } },
    { id: 'wall_room_invariants_2', data: { start: [x, 4] } },
  ])
}

test('I1/I2: closing a loop commits the complete graph once and undo/redo restores identical ids', () => {
  const walls = openRoom()
  const before = useScene.getState().nodes
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  useScene.getState().createNode(walls[3]!, levelId)
  const after = useScene.getState().nodes
  const generated = surfaces()
  expect(generated.map((node) => node.type).sort()).toEqual(['ceiling', 'slab'])
  expect(generated.every((node) => node.autoFromWalls)).toBe(true)
  expect(commits).toHaveLength(1)
  expect(commits[0]!.origin).toBe('local')
  expect(commits[0]!.before.nodes).toEqual(before)
  expect(commits[0]!.current.nodes).toEqual(after)
  expect([...(after[levelId] as LevelNode).children].sort()).toEqual(
    [...walls, ...generated, ...rooms()].map((node) => node.id).sort(),
  )
  for (const wall of walls) {
    expect(after[wall.id]).toMatchObject({ frontSide: 'interior', backSide: 'exterior' })
  }
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.temporal.getState().futureStates).toHaveLength(1)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes).toEqual(after)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})

function closingPatch(commit: SceneCommit): SceneOperationPatch {
  const children = (commit.current.nodes[levelId] as LevelNode).children
  return {
    materialChanges: [],
    nodeDeletes: [],
    nodeCreates: Object.values(commit.current.nodes)
      .filter((node) => !commit.before.nodes[node.id])
      .map((node) => ({ node, position: children.indexOf(node.id) })),
    nodeUpdates: Object.values(commit.current.nodes).flatMap((node) => {
      const before = commit.before.nodes[node.id]
      if (!before) return []
      const data: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(node)) {
        // Structural creates carry child positions; the host patch owns parent link updates.
        if (
          key !== 'children' &&
          JSON.stringify(value) !== JSON.stringify(before[key as keyof AnyNode])
        )
          data[key] = value
      }
      return Object.keys(data).length
        ? [{ id: node.id, data: data as Partial<AnyNode>, removeFields: [] }]
        : []
    }),
  }
}

test('I3: a read-only receiver applies the closing commit with originator ids and no local history', () => {
  const walls = openRoom()
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  useScene.getState().createNode(walls[3]!, levelId)
  expect(commits).toHaveLength(1)
  const commit = commits[0]!
  const patch = closingPatch(commit)
  expect(patch.nodeCreates.map(({ node }) => node.type).sort()).toEqual([
    'ceiling',
    'slab',
    'wall',
    'zone',
  ])
  stopCommits()
  stopDetection()
  // useScene is a singleton: reset it to the peer's pre-edit graph, as in use-scene-commits.test.ts.
  useScene.setState({
    ...structuredClone(commit.before),
    dirtyNodes: new Set<AnyNodeId>(),
    readOnly: true,
  })
  clearSceneHistory()
  const editor = startDetection()
  const received: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((next) => received.push(next))
  expect(applySceneOperationPatch(patch)).toBe(true)
  expect(useScene.getState().nodes).toEqual(commit.current.nodes)
  expect(useScene.getState().rootNodeIds).toEqual(commit.current.rootNodeIds)
  expect(useScene.getState().readOnly).toBe(true)
  expect(Object.values(editor.spaces)).toHaveLength(1)
  expect(
    surfaces()
      .map((node) => node.type)
      .sort(),
  ).toEqual(['ceiling', 'slab'])
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.temporal.getState().futureStates).toHaveLength(0)
  expect(useScene.temporal.getState().isTracking).toBe(true)
  expect(received.map((next) => next.origin)).toEqual(['host'])
})

test.each([0.3, 3])('I4: moving a room wall by %s m preserves both surface ids', (distance) => {
  closeRoom()
  const original = surfaces()
  moveRightWall(8 + distance)
  expect(
    surfaces()
      .map((node) => node.id)
      .sort(),
  ).toEqual(original.map((node) => node.id).sort())
  for (const surface of surfaces()) {
    expect(surface.autoFromWalls).toBe(true)
    expect(Math.max(...surface.polygon.map(([x]) => x))).toBeCloseTo(
      8 + distance + (surface.type === 'ceiling' ? -0.1 : 0.1),
    )
  }
})

test('I4/I9: split preserves larger-side ids and redistributes ceiling children; merge unions them', () => {
  closeRoom()
  const original = surfaces()
  const ceiling = original.find((node): node is CeilingNode => node.type === 'ceiling')!
  const children = [1, 6].map((x, index) =>
    ItemNode.parse({
      id: `item_room_light_${index}`,
      parentId: ceiling.id,
      position: [x, 0, 2],
      asset: {
        id: 'room_light',
        name: 'Room light',
        category: 'lighting',
        thumbnail: '',
        src: '/room-light.glb',
        attachTo: 'ceiling',
      },
    }),
  )
  useScene.getState().createNodes(children.map((node) => ({ node, parentId: ceiling.id })))
  expect([...(useScene.getState().nodes[ceiling.id] as CeilingNode).children].sort()).toEqual(
    children.map((node) => node.id).sort(),
  )
  const divider = WallNode.parse({
    id: 'wall_room_partition',
    parentId: levelId,
    start: [2, 0],
    end: [2, 4],
  })
  useScene.getState().createNode(divider, levelId)
  const split = surfaces()
  expect(split).toHaveLength(3)
  for (const source of original) {
    const retained = useScene.getState().nodes[source.id] as SlabNode | CeilingNode
    if (source.type === 'slab') {
      expect(retained.polygon).toEqual(source.polygon)
      expect((retained as SlabNode).zoneIds).toHaveLength(2)
      continue
    }
    expect(Math.min(...retained.polygon.map(([x]) => x))).toBe(2.05)
    expect(Math.max(...retained.polygon.map(([x]) => x))).toBe(7.9)
    const created = split.filter((node) => node.type === source.type && node.id !== source.id)
    expect(created).toHaveLength(1)
    expect(Math.min(...created[0]!.polygon.map(([x]) => x))).toBe(0.1)
    expect(Math.max(...created[0]!.polygon.map(([x]) => x))).toBe(1.95)
  }
  const leftCeiling = split.find(
    (node): node is CeilingNode => node.type === 'ceiling' && node.id !== ceiling.id,
  )!
  const rightCeiling = useScene.getState().nodes[ceiling.id] as CeilingNode
  expect(leftCeiling.children).toEqual([children[0]!.id])
  expect(rightCeiling.children).toEqual([children[1]!.id])
  expect(useScene.getState().nodes[children[0]!.id]).toMatchObject({
    parentId: leftCeiling.id,
    position: [1, 0, 2],
  })
  expect(useScene.getState().nodes[children[1]!.id]).toMatchObject({
    parentId: rightCeiling.id,
    position: [6, 0, 2],
  })
  useScene.getState().deleteNode(divider.id)
  expect(
    surfaces()
      .map((node) => node.type)
      .sort(),
  ).toEqual(['ceiling', 'slab'])
  for (const merged of surfaces()) {
    expect(split.some((node) => node.id === merged.id)).toBe(true)
    expect(merged.autoFromWalls).toBe(true)
    expect(Math.min(...merged.polygon.map(([x]) => x))).toBe(merged.type === 'ceiling' ? 0.1 : -0.1)
    expect(Math.max(...merged.polygon.map(([x]) => x))).toBe(merged.type === 'ceiling' ? 7.9 : 8.1)
  }
  const mergedCeiling = surfaces().find((node): node is CeilingNode => node.type === 'ceiling')!
  expect([...mergedCeiling.children].sort()).toEqual(children.map((node) => node.id).sort())
  for (const child of children) {
    expect(useScene.getState().nodes[child.id]).toMatchObject({
      parentId: mergedCeiling.id,
      position: child.position,
    })
  }
})

test.each([
  false,
  true,
])('I5: deleting a manual cover restores the connected plate (partition=%s)', (partition) => {
  closeRoom()
  if (partition) {
    useScene
      .getState()
      .createNode(
        WallNode.parse({ id: 'wall_room_partition', start: [2, 0], end: [2, 4] }),
        levelId,
      )
  }
  expect(surfaces().filter((node) => node.type === 'slab')).toHaveLength(1)
  const manual = SlabNode.parse({ id: 'slab_room_manual', polygon, autoFromWalls: false })
  useScene.getState().createNode(manual, levelId)
  expect(
    surfaces()
      .filter((node) => node.type === 'slab' && node.plateRole !== 'base')
      .map((node) => node.id),
  ).toEqual([manual.id])
  useScene.getState().deleteNode(manual.id)
  expect(surfaces().filter((node) => node.type === 'slab')).toHaveLength(1)
  moveRightWall(8.3)
  expect(surfaces().filter((node) => node.type === 'slab')).toHaveLength(1)
  expect(surfaces().filter((node) => node.type === 'ceiling')).toHaveLength(partition ? 2 : 1)
})

test('I6: a polygon-only store edit is ignored; explicit tool demotion protects later edits', () => {
  closeRoom()
  const slab = surfaces().find((node): node is SlabNode => node.type === 'slab')!
  const edited: Array<[number, number]> = [
    [0, 0],
    [8.1, 0],
    [8.1, 4],
    [0, 4],
  ]
  // Boundary tools own demotion; `updateNode` ignores a polygon patch on
  // derived construction, so the sanctioned command is `detachDerivedNode`.
  useScene.getState().updateNode(slab.id, { polygon: edited })
  expect(useScene.getState().nodes[slab.id]).toBe(slab)
  expect((useScene.getState().nodes[slab.id] as SlabNode).autoFromWalls).toBe(true)
  moveRightWall(8.3)
  expect(
    Math.max(...(useScene.getState().nodes[slab.id] as SlabNode).polygon.map(([x]) => x)),
  ).toBeCloseTo(8.4)
  useScene.getState().detachDerivedNode(slab.id, { polygon: edited })
  expect(useScene.getState().nodes[slab.id]).toMatchObject({
    polygon: edited,
    autoFromWalls: false,
  })
  moveRightWall(8.6)
  expect(useScene.getState().nodes[slab.id]).toMatchObject({
    polygon: edited,
    autoFromWalls: false,
  })
})

test('I6: 3D boundary patches detach both surfaces and protect manual ceiling geometry', () => {
  closeRoom()
  const slab = surfaces().find((node): node is SlabNode => node.type === 'slab')!
  const ceiling = surfaces().find((node): node is CeilingNode => node.type === 'ceiling')!
  expect(slab.autoFromWalls).toBe(true)
  expect(ceiling.autoFromWalls).toBe(true)
  const newPolygon: Array<[number, number]> = [
    [0, 0],
    [8.1, 0],
    [8.1, 4],
    [0, 4],
  ]
  // Exact onPolygonChange commits from slab/boundary-editor.tsx and ceiling/boundary-editor.tsx.
  useScene.getState().detachDerivedNode(slab.id, { polygon: newPolygon })
  useScene.getState().detachDerivedNode(ceiling.id, { polygon: newPolygon })
  expect(useScene.getState().nodes[slab.id]).toMatchObject({
    polygon: newPolygon,
    autoFromWalls: false,
  })
  expect(useScene.getState().nodes[ceiling.id]).toMatchObject({
    polygon: newPolygon,
    autoFromWalls: false,
  })
  moveRightWall(8.3)
  expect(useScene.getState().nodes[slab.id]).toMatchObject({
    polygon: newPolygon,
    autoFromWalls: false,
  })
  const movedCeiling = useScene.getState().nodes[ceiling.id] as CeilingNode
  expect(movedCeiling.autoFromWalls).toBe(false)
  expect(Math.max(...movedCeiling.polygon.map(([x]) => x))).toBeCloseTo(8.1)
})

test('I6: floorplan boundary commits demote both generated surfaces and preserve their edited polygons', () => {
  closeRoom()
  const generated = surfaces()
  expect(generated.every((node) => node.autoFromWalls)).toBe(true)
  clearSceneHistory()
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  const newPolygon: Array<[number, number]> = [
    [0, 0],
    [8.1, 0],
    [8.1, 4],
    [0, 4],
  ]
  for (const surface of generated) {
    // `commitRingPatch` in polygon-vertex-affordance.ts routes a boundary
    // reshape through `detachDerivedNode`.
    useScene.getState().detachDerivedNode(surface.id, { polygon: newPolygon })
    expect(useScene.getState().nodes[surface.id]).toMatchObject({
      polygon: newPolygon,
      autoFromWalls: false,
    })
  }
  expect(commits).toHaveLength(2)
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  generated.forEach((surface, index) => {
    expect(commits[index]!.origin).toBe('local')
    expect(commits[index]!.before.nodes[surface.id]).toMatchObject({ autoFromWalls: true })
    expect(commits[index]!.current.nodes[surface.id]).toMatchObject({
      polygon: newPolygon,
      autoFromWalls: false,
    })
  })
  moveRightWall(8.3)
  expect(
    surfaces()
      .map((node) => node.id)
      .sort(),
  ).toEqual(expect.arrayContaining(generated.map((node) => node.id).sort()))
  for (const surface of generated) {
    expect(useScene.getState().nodes[surface.id]).toMatchObject({
      polygon: newPolygon,
      autoFromWalls: false,
    })
  }
})

test('I7: exterior wall deletion preserves enclosure, intent, plate and ceiling', () => {
  const walls = closeRoom()
  const original = surfaces()
  const zone = rooms()[0]!
  useScene.getState().updateNode(zone.id, { name: 'Kitchen', floor: { finish: 'oak' } })
  useScene.getState().deleteNode(walls[3]!.id)
  expect(surfaces()).toHaveLength(2)
  expect(useScene.getState().nodes[zone.id]).toMatchObject({
    enclosureStatus: 'enclosed',
    name: 'Kitchen',
    floor: { finish: 'oak' },
  })
  for (const surface of original) {
    expect(useScene.getState().nodes[surface.id]).toBeDefined()
    expect((useScene.getState().nodes[levelId] as LevelNode).children).toContain(surface.id)
  }
})

test('wall move retains persistent room id in one commit and undo restores it', () => {
  closeRoom()
  const before = useScene.getState().nodes
  const zone = rooms()[0]!
  clearSceneHistory()
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  moveRightWall(9)
  expect(rooms().map((room) => room.id)).toEqual([zone.id])
  expect(rooms()[0]!.polygon).toContainEqual([9, 0])
  expect(commits).toHaveLength(1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})

test('resume reconciles changes made while paused, including nested pauses', () => {
  const walls = openRoom()
  const before = useScene.getState().nodes
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  pauseSpaceDetection()
  pauseSpaceDetection()
  try {
    useScene.getState().createNode(walls[3]!, levelId)
    expect(rooms()).toHaveLength(0)
    resumeSpaceDetection()
    expect(rooms()).toHaveLength(0)
    resumeSpaceDetection()
    expect(rooms()).toHaveLength(1)
    expect(surfaces()).toHaveLength(2)
    expect(commits.at(-1)!.current.nodes).toEqual(useScene.getState().nodes)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  } finally {
    resumeSpaceDetection()
    resumeSpaceDetection()
  }
})

test('zone ceiling opt-out triggers reconciliation; a derived polygon edit is re-derived, a name is kept', () => {
  closeRoom()
  const zone = rooms()[0]!
  useScene.getState().updateNode(zone.id, { hasCeiling: false })
  expect(surfaces().filter((node) => node.type === 'ceiling')).toHaveLength(0)
  moveRightWall(9)
  expect(surfaces().filter((node) => node.type === 'ceiling')).toHaveLength(0)
  const polygon = [
    [20, 20],
    [24, 20],
    [24, 24],
    [20, 24],
  ] as [number, number][]
  const derived = (useScene.getState().nodes[zone.id] as ZoneNode).polygon
  useScene.getState().updateNode(zone.id, { polygon, name: 'Changed' })
  // Hosted reconciliation re-derives the room outline from its walls; the client agrees.
  expect(useScene.getState().nodes[zone.id]).toMatchObject({ polygon: derived, name: 'Changed' })
})

test('separator edits and zone deletion reconcile without generating per-separator slabs', () => {
  closeRoom()
  const separator = SeparatorNode.parse({
    id: 'separator_intent',
    parentId: levelId,
    start: [2, 0],
    end: [2, 4],
  })
  useScene.getState().createNode(separator, levelId)
  expect(rooms()).toHaveLength(2)
  expect(surfaces().filter((node) => node.type === 'ceiling')).toHaveLength(2)
  expect(surfaces().filter((node) => node.type === 'slab')).toHaveLength(1)
  const room = rooms()[0]!
  useScene.getState().deleteNode(room.id)
  expect(rooms()).toHaveLength(2)
  expect(rooms().some((zone) => zone.id === room.id)).toBe(false)
  expect(surfaces().filter((node) => node.type === 'ceiling')).toHaveLength(2)
  useScene.getState().deleteNode(separator.id)
  expect(rooms()).toHaveLength(1)
  expect(surfaces().filter((node) => node.type === 'ceiling')).toHaveLength(1)
})

test.each([
  false,
  true,
])('host patches never derive, including an external temporal pause (%s)', (paused) => {
  const walls = openRoom()
  if (paused) useScene.temporal.getState().pause()
  try {
    expect(
      applySceneOperationPatch({
        materialChanges: [],
        nodeCreates: [{ node: walls[3]!, position: 3 }],
        nodeUpdates: [],
        nodeDeletes: [],
      }),
    ).toBe(true)
    expect(rooms()).toHaveLength(0)
    expect(surfaces()).toHaveLength(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.temporal.getState().isTracking).toBe(!paused)
  } finally {
    useScene.temporal.getState().resume()
  }
})

test.each([
  false,
  true,
])('explicit ceiling deletion persists zone opt-out in one undo step (paused=%s)', (paused) => {
  closeRoom()
  const before = useScene.getState().nodes
  const zone = rooms()[0]!
  const ceiling = surfaces().find((node) => node.type === 'ceiling')!
  clearSceneHistory()
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  if (paused) pauseSpaceDetection()
  try {
    useScene.getState().deleteNode(ceiling.id)
  } finally {
    if (paused) resumeSpaceDetection()
  }
  expect(rooms()[0]).toMatchObject({ id: zone.id, hasCeiling: false })
  expect(surfaces().filter((node) => node.type === 'ceiling')).toEqual([])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(commits.at(-1)!.current.nodes[zone.id]).toMatchObject({ hasCeiling: false })
  if (!paused) expect(commits).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  useScene.temporal.getState().redo()
  moveRightWall(9)
  expect(surfaces().filter((node) => node.type === 'ceiling')).toEqual([])
  useScene.getState().updateNode(zone.id, { hasCeiling: true })
  expect(surfaces().filter((node) => node.type === 'ceiling')).toHaveLength(1)
})

test('a pre-existing manual ceiling prevents automatic ceiling creation on close', () => {
  const walls = openRoom()
  const manual = CeilingNode.parse({ id: 'ceiling_existing', polygon, height: 2.1 })
  useScene.getState().createNode(manual, levelId)
  useScene.getState().createNode(walls[3]!, levelId)
  expect(
    surfaces()
      .filter((node) => node.type === 'ceiling')
      .map((node) => node.id),
  ).toEqual([manual.id])
  moveRightWall(8.3)
  expect(
    surfaces()
      .filter((node) => node.type === 'ceiling')
      .map((node) => node.id),
  ).toEqual([manual.id])
})

test('a covering slab edit reclamps a manual ceiling in the same commit and undo step', () => {
  closeRoom()
  const ceiling = surfaces().find((node) => node.type === 'ceiling')!
  useScene.getState().detachDerivedNode(ceiling.id, { height: 2.4 })
  const above = LevelNode.parse({ id: 'level_above', parentId: buildingId, level: 1 })
  useScene.getState().createNode(above, buildingId)
  const slab = SlabNode.parse({
    id: 'slab_above',
    parentId: above.id,
    polygon,
    elevation: 0,
    thickness: 0.1,
  })
  useScene.getState().createNode(slab, above.id)
  const before = useScene.getState().nodes
  clearSceneHistory()
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  useScene.getState().updateNode(slab.id, { thickness: 0.5 })
  expect(useScene.getState().nodes[ceiling.id]).toMatchObject({ height: 1.99 })
  expect(commits).toHaveLength(1)
  expect(commits[0]!.current.nodes[ceiling.id]).toMatchObject({ height: 1.99 })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})

test('raising a room keeps its base id and wall hosts in one commit and undo step', () => {
  const walls = closeRoom()
  const zone = rooms()[0]!
  const previousPlate = surfaces().find((node): node is SlabNode => node.type === 'slab')!
  const stair = StairNode.parse({ id: 'stair_plate_host', deckSlabId: previousPlate.id })
  useScene.getState().createNode(stair, levelId)
  useScene.getState().updateNode(walls[0]!.id, { supportSlabId: previousPlate.id })
  const before = useScene.getState().nodes
  clearSceneHistory()
  const commits: SceneCommit[] = []
  stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
  useScene.getState().updateNode(zone.id, { floor: { elevation: 0.4 } })
  const after = useScene.getState().nodes
  const plate = surfaces().find((node): node is SlabNode => node.type === 'slab')!
  expect(plate.id).toBe(previousPlate.id)
  expect(plate.elevation).toBe(0.05)
  const platform = surfaces().find(
    (node): node is SlabNode => node.type === 'slab' && node.plateRole === 'platform',
  )!
  expect(platform.elevation).toBe(0.4)
  expect(platform.thickness).toBeCloseTo(0.35)
  expect(after[walls[0]!.id]).toMatchObject({ supportSlabId: plate.id })
  expect(after[stair.id]).toMatchObject({ deckSlabId: plate.id })
  expect(commits).toHaveLength(1)
  expect(commits[0]!.current.nodes).toEqual(after)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes).toEqual(after)
})

test('zone floor intent creates platforms in one commit while retaining the base', () => {
  closeRoom()
  const plate = surfaces().find((node): node is SlabNode => node.type === 'slab')!
  const zone = rooms()[0]!
  for (const elevation of [0.4, 0.6]) {
    const before = useScene.getState().nodes
    clearSceneHistory()
    const commits: SceneCommit[] = []
    stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().updateNode(zone.id, { floor: { elevation } })
    expect(useScene.getState().nodes[plate.id]).toMatchObject({ elevation: 0.05 })
    expect(
      surfaces().find((node) => node.type === 'slab' && node.plateRole === 'platform'),
    ).toMatchObject({ elevation })
    expect(useScene.getState().nodes[zone.id]).toMatchObject({ floor: { elevation } })
    expect(commits).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    stopCommits()
  }
  moveRightWall(9)
  expect(useScene.getState().nodes[plate.id]).toMatchObject({ elevation: 0.05 })
})
