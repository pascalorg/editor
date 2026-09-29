import { afterEach, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  computeWallSlabSupport,
  SlabNode,
  sceneRegistry,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { floorStepFixture } from '../../../../core/src/systems/slab/__fixtures__/floor-step'
import { generateExtrudedWall } from './wall-system'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

for (const justification of [undefined, 'a', 'b'] as const)
  test(`face notch follows the body center: ${justification ?? 'center'}`, () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2, justification })
    const geometry = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters([wall]),
      0.05,
      0.05,
      undefined,
      2.5,
      undefined,
      {
        a: [{ start: 0, end: 1, elevation: 0.05 }],
        b: [{ start: 0, end: 1, elevation: -0.4 }],
      },
    )
    const position = geometry.getAttribute('position')
    const center = justification === 'a' ? 0.1 : justification === 'b' ? -0.1 : 0
    let high = Infinity,
      low = Infinity
    for (let i = 0; i < position.count; i++) {
      if (position.getZ(i) > center + 0.001) high = Math.min(high, position.getY(i))
      if (position.getZ(i) < center - 0.001) low = Math.min(low, position.getY(i))
    }
    expect(high + 0.05).toBeCloseTo(0.05, 6)
    expect(low + 0.05).toBeCloseTo(-0.4, 6)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.max.y + 0.05).toBeCloseTo(2.5, 6)
    geometry.dispose()
  })

test('a door exposes the step below its unchanged sill while adjacent low wall covers it', () => {
  const { divider, door, walls, slabs, nodes } = floorStepFixture()
  const support = computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, nodes)
  const registered = new Mesh()
  sceneRegistry.nodes.set(divider.id, registered)
  cleanups.push(() => {
    sceneRegistry.nodes.delete(divider.id)
    registered.geometry.dispose()
  })
  const geometry = generateExtrudedWall(
    divider,
    [door],
    calculateLevelMiters(walls),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    2.5,
    undefined,
    support.faceDatum,
    undefined,
    nodes,
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(2, -0.2 - support.elevation, -1), new Vector3(0, 0, 1))
  expect(ray.intersectObject(mesh)).toHaveLength(0)
  ray.ray.origin.x = 1
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  expect(door.position[1] - door.height / 2 + support.elevation).toBe(0.05)
  geometry.dispose()
  material.dispose()
})

test('piecewise face bases cut only the corresponding side and longitudinal run', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2 })
  const geometry = generateExtrudedWall(
    wall,
    [],
    calculateLevelMiters([wall]),
    0.05,
    0.05,
    undefined,
    2.5,
    undefined,
    {
      a: [{ start: 0, end: 1, elevation: 0.05 }],
      b: [
        { start: 0, end: 0.5, elevation: -0.4 },
        { start: 0.5, end: 1, elevation: -0.1 },
      ],
    },
  )
  const positions = geometry.getAttribute('position')
  let left = Infinity,
    right = Infinity
  for (let i = 0; i < positions.count; i++) {
    if (positions.getZ(i) > -0.09) continue
    if (positions.getX(i) < 1.9) left = Math.min(left, positions.getY(i))
    if (positions.getX(i) > 2.1) right = Math.min(right, positions.getY(i))
  }
  expect(left + 0.05).toBeCloseTo(-0.4, 6)
  expect(right + 0.05).toBeCloseTo(-0.1, 6)
  geometry.dispose()
})

test('equal-elevation fixture meshes retain every pre-phase-5 geometry byte', async () => {
  const { createHash } = await import('node:crypto')
  const { SlabNode } = await import('@pascal-app/core')
  const { default: fixtures } = await import(
    '../../../../core/src/systems/wall/__fixtures__/wall-frame-golden.json'
  )
  const { default: hashes } = await import('./wall-floor-step-golden.json')
  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const walls = fixture.walls.map((wall) => WallNode.parse(wall))
    const slabs = fixture.slabs.map((slab) => SlabNode.parse(slab))
    const miters = calculateLevelMiters(walls)
    for (const [wallIndex, wall] of walls.entries()) {
      const support = computeWallSlabSupport(wall, slabs, walls)
      const geometry = generateExtrudedWall(
        wall,
        [],
        miters,
        support.elevation,
        support.baseElevation,
        support.baseSegments,
        undefined,
        undefined,
        support.faceDatum,
      )
      const hash = createHash('sha256')
      for (const key of Object.keys(geometry.attributes).sort())
        hash.update(Buffer.from(geometry.attributes[key]!.array.buffer))
      if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer))
      hash.update(JSON.stringify(geometry.groups))
      expect(hash.digest('hex')).toBe(hashes[fixtureIndex]![wallIndex]!)
      geometry.dispose()
    }
  }
})

test('curved wall halves retain their own floors along the arc', async () => {
  const { getWallCurveFrameAt } = await import('@pascal-app/core')
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2, curveOffset: 0.6 })
  const geometry = generateExtrudedWall(
    wall,
    [],
    calculateLevelMiters([wall]),
    0.05,
    0.05,
    undefined,
    2.5,
    undefined,
    {
      a: [{ start: 0, end: 1, elevation: 0.05 }],
      b: [{ start: 0, end: 1, elevation: -0.4 }],
    },
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  for (const t of [0.2, 0.5, 0.8]) {
    const frame = getWallCurveFrameAt(wall, t)
    for (const [offset, base] of [
      [0.05, 0.05],
      [-0.05, -0.4],
    ]) {
      const ray = new Raycaster(
        new Vector3(
          frame.point.x + frame.normal.x * offset!,
          -1,
          frame.point.y + frame.normal.y * offset!,
        ),
        new Vector3(0, 1, 0),
      )
      const hit = ray.intersectObject(mesh)[0]!
      expect(hit.point.y + 0.05).toBeCloseTo(base!, 5)
    }
  }
  geometry.dispose()
  material.dispose()
})

test('floor-anchored door follows its local face datums along a mixed support wall', () => {
  const { walls, slabs, nodes, door } = floorStepFixture()
  const wall = walls[0]!
  // Both sides must border rooms: a sunken room's exterior now stays at grade.
  const lowerRoom = ZoneNode.parse({
    id: 'zone_step_south',
    name: 'Sunken south room',
    parentId: wall.parentId,
    spaceRole: 'room',
    polygon: [
      [4, -4],
      [8, -4],
      [8, 0],
      [4, 0],
    ],
    floor: { elevation: -0.4 },
  })
  const lowerPlate = SlabNode.parse({
    id: 'slab_step_south',
    parentId: wall.parentId,
    boundary: 'auto',
    zoneIds: [lowerRoom.id],
    elevation: -0.4,
    polygon: [
      [3.9, -4.1],
      [8.1, -4.1],
      [8.1, 0.1],
      [3.9, 0.1],
    ],
  })
  const outline: [number, number][] = [
    [4, 0],
    [4, -4],
    [8, -4],
    [8, 0],
  ]
  for (let i = 0; i < 3; i++) {
    const boundary = WallNode.parse({
      parentId: wall.parentId,
      start: outline[i],
      end: outline[i + 1],
      thickness: 0.2,
    })
    walls.push(boundary)
    nodes[boundary.id] = boundary
  }
  nodes[lowerRoom.id] = lowerRoom
  nodes[lowerPlate.id] = lowerPlate
  slabs.push(lowerPlate)
  const opening = {
    ...door,
    parentId: wall.id,
    wallId: wall.id,
    position: [6, 1, 0] as [number, number, number],
  }
  const support = computeWallSlabSupport(wall, slabs, walls, slabs[0]!.id, undefined, 0, nodes)
  expect(support.elevation).toBe(0.05)
  for (const face of ['a', 'b'] as const)
    expect(
      support.faceDatum[face].find((span) => span.start <= 0.75 && span.end > 0.75)?.elevation,
    ).toBe(-0.4)
  const registered = new Mesh()
  sceneRegistry.nodes.set(wall.id, registered)
  cleanups.push(() => {
    sceneRegistry.nodes.delete(wall.id)
    registered.geometry.dispose()
  })
  const geometry = generateExtrudedWall(
    wall,
    [opening],
    calculateLevelMiters(walls),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    2.5,
    undefined,
    support.faceDatum,
    undefined,
    nodes,
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(6, -0.2 - support.elevation, -1), new Vector3(0, 0, 1))
  expect(ray.intersectObject(mesh)).toHaveLength(0)
  ray.ray.origin.y = 1
  expect(ray.intersectObject(mesh)).toHaveLength(0)
  geometry.dispose()
  material.dispose()
})

test('a floor-length window removes wall fill where the plate supplies the step', async () => {
  const { WindowNode } = await import('@pascal-app/core')
  const { walls, divider, slabs, nodes, door } = floorStepFixture()
  const window = WindowNode.parse({
    ...door,
    id: 'window_step',
    type: 'window',
    openingKind: 'window',
  })
  const support = computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, nodes)
  const registered = new Mesh()
  sceneRegistry.nodes.set(divider.id, registered)
  cleanups.push(() => {
    sceneRegistry.nodes.delete(divider.id)
    registered.geometry.dispose()
  })
  const geometry = generateExtrudedWall(
    divider,
    [window],
    calculateLevelMiters(walls),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    2.5,
    undefined,
    support.faceDatum,
    undefined,
    nodes,
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(2, -0.2 - support.elevation, -1), new Vector3(0, 0, 1))
  expect(ray.intersectObject(mesh)).toHaveLength(0)
  ray.ray.origin.x = 1
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  geometry.dispose()
  material.dispose()
})

test('a door crossing face datums keeps an upstand without a carrying plate', async () => {
  const { DoorNode } = await import('@pascal-app/core')
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2 })
  const door = DoorNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    width: 2,
    height: 2,
    position: [2, 1, 0],
  })
  const registered = new Mesh()
  sceneRegistry.nodes.set(wall.id, registered)
  cleanups.push(() => {
    sceneRegistry.nodes.delete(wall.id)
    registered.geometry.dispose()
  })
  const geometry = generateExtrudedWall(
    wall,
    [door],
    calculateLevelMiters([wall]),
    0.05,
    0.05,
    undefined,
    2.5,
    undefined,
    {
      a: [
        { start: 0, end: 0.5, elevation: 0.05 },
        { start: 0.5, end: 1, elevation: -0.4 },
      ],
      b: [{ start: 0, end: 1, elevation: -0.4 }],
    },
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(1.5, -0.25, -1), new Vector3(0, 0, 1))
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  ray.ray.origin.x = 2.5
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  geometry.dispose()
  material.dispose()
})
