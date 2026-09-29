import { expect, test } from 'bun:test'
import { containsPoint } from '../../lib/polygon-boolean'
import { extractRooms } from '../../lib/room-graph'
import { initSpaceDetectionSync } from '../../lib/space-detection'
import { reconcileSceneStructure } from '../../lib/structure-reconcile'
import { LevelNode, type SeparatorNode, WallNode, type ZoneNode } from '../../schema'
import { subscribeSceneCommits } from '../../store/history-control'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { getWallCurveFrameAt } from '../../systems/wall/wall-curve'
import { createZone } from './create-zone'
import { divideZone } from './divide-zone'
import { applyToScratch, boundaries, type Point, structureChangeBatch } from './shared'

const levelId = 'level_path'
const rectangle: Point[] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
const island: Point[] = [
  [3, 1],
  [5, 1],
  [5, 3],
  [3, 3],
]
const elbow: Point[] = [
  [2, 0],
  [2, 2],
  [8, 2],
]
function setup(thickness = 0.2) {
  let i = 0
  const mintId = (kind: string) => `${kind}_path_${++i}`
  const level = LevelNode.parse({ id: levelId })
  const source = { [level.id]: level }
  const plan = createZone(source, {
    levelId,
    polygon: rectangle,
    enclose: true,
    wall: { thickness },
    mintId,
    intent: { floor: { finish: 'oak', elevation: 0.2 }, wallMaterial: 'paint' },
  })
  const nodes = reconcileSceneStructure({
    nodes: applyToScratch(source, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  return { nodes, zoneId: plan.zoneId, mintId }
}
function run(path: Point[], closed = false, thickness = 0.2) {
  const fixture = setup(thickness)
  const plan = divideZone(fixture.nodes, { ...fixture, path, closed })
  expect(plan.conflicts).toBeUndefined()
  const draft = applyToScratch(fixture.nodes, structureChangeBatch(plan.changes))
  const faces = extractRooms(boundaries(draft, levelId))
  const result = reconcileSceneStructure({
    nodes: draft,
    previousNodes: fixture.nodes,
    mintId: fixture.mintId,
  })
  return {
    ...fixture,
    plan,
    faces,
    result,
    separators: plan.changes.flatMap((p) => (p.op === 'create' ? [p.node as SeparatorNode] : [])),
  }
}

test('L-shaped open path shares exact endpoints and splits wall T-vertices into two zones', () => {
  const { plan, separators, faces, result } = run(elbow)
  expect(plan.separatorIds).toHaveLength(2)
  expect(separators[0]!.end).toEqual(separators[1]!.start)
  expect(separators.map((s) => [s.start, s.end])).toEqual([
    [elbow[0]!, elbow[1]!],
    [elbow[1]!, elbow[2]!],
  ])
  expect(faces).toHaveLength(2)
  expect(Object.values(result.nodes).filter((n) => n.type === 'zone')).toHaveLength(2)
  for (const face of faces) expect(face.spans.filter((s) => s.kind === 'separator')).toHaveLength(2)
})

test.each([
  false,
  true,
])('four-point island preserves outer identity, inherits finishes and keeps one unholed base and two platforms (reverse=%s)', (reverse) => {
  const { zoneId, plan, separators, faces, result, mintId } = run(
    reverse ? [...island].reverse() : island,
    true,
  )
  expect(plan.separatorIds).toHaveLength(4)
  expect(separators.at(-1)!.end).toEqual(separators[0]!.start)
  expect(faces).toHaveLength(2)
  const outer = result.nodes[zoneId] as ZoneNode
  const zones = Object.values(result.nodes).filter((n) => n.type === 'zone')
  expect(zones).toHaveLength(2)
  expect(outer.holes).toHaveLength(1)
  expect(containsPoint([{ outer: outer.polygon, holes: outer.holes }], outer.seed!)).toBe(true)
  for (const zone of zones)
    expect(zone).toMatchObject({ floor: { finish: 'oak', elevation: 0.2 }, wallMaterial: 'paint' })
  const inner = zones.find((n) => n.id !== zoneId)!
  expect(inner.holes).toEqual([])
  expect(inner.boundaryWallIds).toEqual([])
  expect(inner.boundarySeparatorIds.sort()).toEqual([...plan.separatorIds].sort())
  const plates = Object.values(result.nodes).filter((n) => n.type === 'slab')
  expect(plates).toHaveLength(3)
  const base = plates.find((plate) => plate.plateRole === 'base')!
  expect(base.holes).toEqual([])
  expect(base.zoneIds?.sort()).toEqual(zones.map((z) => z.id).sort())
  const ceilings = Object.values(result.nodes).filter((n) => n.type === 'ceiling')
  expect(ceilings).toHaveLength(2)
  expect(ceilings.find((c) => c.zoneId === zoneId)!.holes).toHaveLength(1)
  expect(reconcileSceneStructure({ nodes: result.nodes, mintId }).patches).toEqual([])
})

test('minimum 0.25 m² island is a graph face', () => {
  expect(
    run(
      [
        [3, 1],
        [3.5, 1],
        [3.5, 1.5],
        [3, 1.5],
      ],
      true,
    ).faces,
  ).toHaveLength(2)
})

test('5 cm island clearance is measured from thin wall faces, without graph snapping', () => {
  const { result, zoneId } = run(
    [
      [0.06, 1],
      [1.06, 1],
      [1.06, 2],
      [0.06, 2],
    ],
    true,
    0.02,
  )
  expect((result.nodes[zoneId] as ZoneNode).holes).toHaveLength(1)
})

test('open path keeps its snapped curved-wall endpoint connected', () => {
  const fixture = setup()
  const bottom = Object.values(fixture.nodes).find(
    (n) => n.type === 'wall' && n.start[1] === 0 && n.end[1] === 0,
  ) as WallNode
  const curved = { ...bottom, curveOffset: 1 }
  const nodes = reconcileSceneStructure({
    nodes: { ...fixture.nodes, [curved.id]: curved },
    mintId: fixture.mintId,
  }).nodes
  const { point } = getWallCurveFrameAt(curved, 0.37)
  const plan = divideZone(nodes, {
    zoneId: fixture.zoneId,
    path: [
      [point.x, point.y],
      [point.x, 2],
      [8, 2],
    ],
    startBoundaryId: curved.id,
    mintId: fixture.mintId,
  })
  expect(plan.conflicts).toBeUndefined()
  const draft = applyToScratch(nodes, structureChangeBatch(plan.changes))
  expect(extractRooms(boundaries(draft, levelId))).toHaveLength(2)
})

test('open paths preserve free intermediate points, legacy cut and boundary hints', () => {
  const fixture = setup()
  const input = { zoneId: fixture.zoneId, mintId: fixture.mintId }
  const path: Point[] = [
    [2.1, 0.1],
    [2.123, 2.456],
    [7.9, 2.1],
  ]
  const plan = divideZone(fixture.nodes, { ...input, path })
  expect(plan.conflicts).toBeUndefined()
  const nodes = plan.changes.flatMap((p) => (p.op === 'create' ? [p.node as SeparatorNode] : []))
  expect(nodes[0]!.start).toEqual([2.1, 0])
  expect(nodes[0]!.end).toEqual(path[1]!)
  expect(nodes[1]!.end).toEqual([8, 2.1])
  expect(path[0]).toEqual([2.1, 0.1])
  const cut = divideZone(fixture.nodes, {
    ...input,
    cut: [
      [2, 0],
      [2, 4],
    ],
  })
  expect(cut.separatorIds).toEqual([cut.separatorId!])
  expect(
    divideZone(fixture.nodes, {
      ...input,
      path: [
        [4, 2],
        [4, 4],
      ],
    }).conflicts?.[0]?.code,
  ).toBe('snap-distance')
  const walls = Object.values(fixture.nodes).filter((n) => n.type === 'wall')
  const bottom = walls.find((w) => w.start[1] === 0 && w.end[1] === 0)!
  const top = walls.find((w) => w.start[1] === 4 && w.end[1] === 4)!
  const hinted = divideZone(fixture.nodes, {
    ...input,
    path: [
      [4, 2],
      [4, 2],
    ],
    startBoundaryId: bottom.id,
    endBoundaryId: top.id,
  })
  expect(hinted.conflicts).toBeUndefined()
})

for (const [label, path, closed, code] of [
  [
    'open self-intersection',
    [
      [1, 0],
      [6, 3],
      [1, 3],
      [6, 0],
    ],
    false,
    'self-intersection',
  ],
  [
    'closed self-intersection',
    [
      [1, 1],
      [6, 3],
      [1, 3],
      [6, 1],
    ],
    true,
    'self-intersection',
  ],
  [
    'retraced segment',
    [
      [2, 0],
      [2, 2],
      [2, 1],
      [8, 1],
    ],
    false,
    'self-intersection',
  ],
  [
    'outside intermediate point',
    [
      [2, 0],
      [-1, 2],
      [2, 4],
    ],
    false,
    'outside-room',
  ],
  [
    'outside island',
    [
      [7, 1],
      [9, 1],
      [9, 3],
      [7, 3],
    ],
    true,
    'outside-room',
  ],
  [
    'boundary overlap',
    [
      [0, 1],
      [0, 2],
      [8, 2],
    ],
    false,
    'boundary-overlap',
  ],
  [
    'short segment',
    [
      [2, 0],
      [2, 0.04],
      [8, 2],
    ],
    false,
    'short-cut',
  ],
  [
    'small island',
    [
      [3, 1],
      [3.4, 1],
      [3.4, 1.4],
      [3, 1.4],
    ],
    true,
    'small-island',
  ],
  [
    'wall clearance',
    [
      [0.14, 1],
      [1.14, 1],
      [1.14, 2],
      [0.14, 2],
    ],
    true,
    'wall-clearance',
  ],
  [
    'touching island',
    [
      [0, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ],
    true,
    'outside-room',
  ],
] as [string, Point[], boolean, string][]) {
  test(`rejects ${label} without changes`, () => {
    const fixture = setup()
    const plan = divideZone(fixture.nodes, { ...fixture, path, closed })
    expect(plan.changes).toEqual([])
    expect(plan.separatorIds).toEqual([])
    expect(plan.conflicts?.[0]?.code).toBe(code)
  })
}

test('open and closed paths cannot cross or enclose an existing hole', () => {
  const fixture = setup()
  const inner: Point[] = [
    [3, 1],
    [5, 1],
    [5, 3],
    [3, 3],
  ]
  const walls = inner.map((start, i) =>
    WallNode.parse({
      id: fixture.mintId('wall'),
      parentId: levelId,
      start,
      end: inner[(i + 1) % 4],
    }),
  )
  const nodes = reconcileSceneStructure({
    nodes: { ...fixture.nodes, ...Object.fromEntries(walls.map((w) => [w.id, w])) },
    mintId: fixture.mintId,
  }).nodes
  const outer = Object.values(nodes).find((n) => n.type === 'zone' && n.holes.length)!
  for (const [path, closed] of [
    [
      [
        [0, 2],
        [2, 2],
        [8, 2],
      ],
      false,
    ],
    [
      [
        [2, 2],
        [4, 2],
        [4, 3.5],
        [2, 3.5],
      ],
      true,
    ],
    [
      [
        [2, 0.5],
        [6, 0.5],
        [6, 3.5],
        [2, 3.5],
      ],
      true,
    ],
  ] as [Point[], boolean][]) {
    const plan = divideZone(nodes, { zoneId: outer.id, path, closed, mintId: fixture.mintId })
    expect(plan.changes).toEqual([])
    expect(plan.conflicts?.[0]?.code).toBe('outside-room')
  }
})

test.each([
  false,
  true,
])('multi-separator Divide is one commit and one undo step (closed=%s)', (closed) => {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  const previous = useScene.getState()
  const fixture = setup()
  useScene.setState({
    nodes: fixture.nodes,
    rootNodeIds: [levelId],
    readOnly: false,
    materials: {},
    collections: {},
  })
  clearSceneHistory()
  const stop = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
  const origins: string[] = []
  const unsubscribe = subscribeSceneCommits((commit) => origins.push(commit.origin))
  try {
    const plan = divideZone(fixture.nodes, { ...fixture, path: closed ? island : elbow, closed })
    expect(plan.conflicts).toBeUndefined()
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    const after = useScene.getState().nodes
    expect(Object.values(after).filter((n) => n.type === 'separator')).toHaveLength(closed ? 4 : 2)
    expect(Object.values(after).filter((n) => n.type === 'zone')).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(origins).toEqual(['local'])
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(fixture.nodes)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(after)
  } finally {
    unsubscribe()
    stop()
    useScene.setState(previous)
    clearSceneHistory()
  }
})
