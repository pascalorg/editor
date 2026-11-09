import { expect, test } from 'bun:test'
import {
  classifyPlateSideAt,
  computePlateSurfacePartition,
  plateSideRuns,
} from '../../lib/plate-surface'
import { floorStepFixture } from './__fixtures__/floor-step'
import { computeWallSlabSupport } from './slab-support'

test('room faces follow 0.05 / -0.40 floors without changing hosted support', () => {
  const { divider, walls, slabs, nodes } = floorStepFixture()
  const support = computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, nodes)
  expect(support.faceDatum).toEqual({
    a: [{ start: 0, end: 1, elevation: 0.05 }],
    b: [{ start: 0, end: 1, elevation: -0.4 }],
  })
  const legacy = computeWallSlabSupport(
    divider,
    slabs,
    walls,
    undefined,
    undefined,
    0,
    Object.fromEntries(
      Object.entries(nodes).map(([id, node]) => [
        id,
        node.type === 'zone' ? { ...node, spaceRole: 'generic' } : node,
      ]),
    ),
  )
  expect(support.elevation).toBe(0.05)
  expect(support.baseElevation).toBe(legacy.baseElevation)
  expect(support.baseSegments).toEqual(legacy.baseSegments)
  const again = computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, nodes)
  expect(computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, nodes)).toBe(again)
})

test('one wall face changes floor at the topology span station', () => {
  const { walls, slabs, nodes } = floorStepFixture()
  const support = computeWallSlabSupport(walls[0]!, slabs, walls, undefined, undefined, 0, nodes)
  expect(support.faceDatum.a).toEqual([
    { start: 0, end: 0.5, elevation: 0.05 },
    { start: 0.5, end: 1, elevation: -0.4 },
  ])
})

test('plate riser is hidden under the wall and exposed only under its floor opening', () => {
  const { walls, zones, slabs, door } = floorStepFixture()
  const context = { walls, zones, slabs }
  const plate = slabs[0]!
  const closed = computePlateSurfacePartition(plate, context)!
  expect(classifyPlateSideAt(closed, [4.1, 2])).toBe('hidden')
  const opened = computePlateSurfacePartition(plate, { ...context, openings: [door] })!
  expect(plateSideRuns(opened, [4.1, 0.2], [4.1, 3.8]).map((run) => run.role)).toEqual([
    'hidden',
    'riser',
    'hidden',
  ])
  expect(classifyPlateSideAt(opened, [4.1, 2])).toBe('riser')
  expect(classifyPlateSideAt(opened, [4.1, 1])).toBe('hidden')
  const raised = computePlateSurfacePartition(plate, {
    ...context,
    openings: [{ ...door, position: [2, 2, 0] }],
  })!
  expect(classifyPlateSideAt(raised, [4.1, 2])).toBe('hidden')
})

test('a separator between different room floors exposes the step', () => {
  const { walls, zones, slabs } = floorStepFixture(true)
  const partition = computePlateSurfacePartition(slabs[0]!, { walls, zones, slabs })!
  expect(classifyPlateSideAt(partition, [4, 2])).toBe('riser')
})

test('room face bases are lazy and cached without changing the enumerable support contract', () => {
  const { divider, walls, slabs, nodes } = floorStepFixture()
  let scans = 0
  const tracked = new Proxy(nodes, {
    ownKeys(target) {
      scans++
      return Reflect.ownKeys(target)
    },
  })
  const support = computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, tracked)
  expect(support.elevation).toBe(0.05)
  expect(Object.keys({ ...support })).not.toContain('faceBase')
  expect(scans).toBe(0)
  const bases = support.faceDatum
  expect(scans).toBeGreaterThan(0)
  const roomScans = scans
  expect(support.faceDatum).toBe(bases)
  expect(scans).toBe(roomScans)
  // The first exterior face initializes terrain lookup; room-only queries do not.
  expect(
    computeWallSlabSupport(walls[0]!, slabs, walls, undefined, undefined, 0, tracked).faceDatum,
  ).toBeDefined()
  const after = scans
  for (const wall of walls)
    expect(
      computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, tracked).faceDatum,
    ).toBeDefined()
  expect(scans).toBe(after)
})

test('room floors cannot lift wall faces over a stair hole above their elected bases', () => {
  const fixture = floorStepFixture()
  const hole: [number, number][] = [
    [3, 1],
    [5, 1],
    [5, 3],
    [3, 3],
  ]
  const slabs = fixture.slabs.map((slab) => ({ ...slab, elevation: 0.05, holes: [hole] }))
  const nodes = { ...fixture.nodes, ...Object.fromEntries(slabs.map((slab) => [slab.id, slab])) }
  const support = computeWallSlabSupport(
    fixture.divider,
    slabs,
    fixture.walls,
    undefined,
    undefined,
    0,
    nodes,
  )
  for (const face of ['a', 'b'] as const) {
    expect(
      support.faceDatum[face].find((span) => span.start <= 0.5 && span.end > 0.5)?.elevation,
    ).toBe(0)
    expect(support.faceDatum[face][0]!.elevation).toBe(0.05)
  }
})

test('facade slab edges remain explicit at equal elevations and on upper storeys', () => {
  const { walls, zones, slabs } = floorStepFixture()
  for (const elevation of [0.05, 3.05]) {
    const equal = slabs.map((slab) => ({
      ...slab,
      elevation,
      thickness: 0.05,
      plateRole: 'base' as const,
    }))
    const partition = computePlateSurfacePartition(equal[0]!, { walls, zones, slabs: equal })!
    expect(classifyPlateSideAt(partition, [2, -0.1])).toBe('edge')
    expect(classifyPlateSideAt(partition, [4.1, 2])).toBe('hidden')
    expect(
      partition.sides.some(
        (side) => side.role === 'edge' && side.start[1] === -0.1 && side.end[1] === -0.1,
      ),
    ).toBe(true)
  }
})

test('room and separator edits dirty wall bodies on their level', async () => {
  const { initSpatialGridSync } = await import('../../hooks/spatial-grid/spatial-grid-sync')
  const { spatialGridManager } = await import('../../hooks/spatial-grid/spatial-grid-manager')
  const { default: useScene } = await import('../../store/use-scene')
  const { walls, zones, boundary, nodes } = floorStepFixture(true)
  const original = useScene.getState()
  useScene.setState({ nodes, dirtyNodes: new Set() })
  const unsubscribe = initSpatialGridSync()
  try {
    const zone = zones[0]!
    for (const patch of [
      { floor: { elevation: -0.8 } },
      { hasFloor: false as const },
      { polygon: zone.polygon.map(([x, y]) => [x + 0.01, y] as [number, number]) },
      { boundaryWallIds: walls.map((wall) => wall.id) },
      { boundarySeparatorIds: [boundary.id] },
    ]) {
      useScene.setState({ dirtyNodes: new Set() })
      useScene.setState({ nodes: { ...nodes, [zone.id]: { ...zone, ...patch } } })
      for (const wall of walls) expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
    }
    useScene.setState({ dirtyNodes: new Set() })
    useScene.setState({ nodes: { ...nodes, [boundary.id]: { ...boundary, end: [4, 3] } } })
    for (const wall of walls) expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
    const removed = { ...nodes }
    delete removed[boundary.id]
    useScene.setState({ dirtyNodes: new Set() })
    useScene.setState({ nodes: removed })
    for (const wall of walls) expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
  } finally {
    unsubscribe()
    spatialGridManager.clear()
    useScene.setState(original)
  }
})
