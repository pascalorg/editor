import { expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  computeWallSlabSupport,
  createTerrainField,
  encodeTerrainField,
  levelBaseElevationAt,
  sceneRegistry,
} from '@pascal-app/core'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { raisedRoomFixture } from '../../../../core/src/systems/slab/__fixtures__/raised-room'
import { generateExtrudedWall } from './wall-system'

for (const terrain of [false, true])
  test(`platform walls meet the outside ground and inside floor: terrain=${terrain}`, () => {
    const { walls, slabs, nodes } = raisedRoomFixture(false, terrain)
    for (const wall of walls) {
      const support = computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)
      for (const height of [undefined, 2.5]) {
        const geometry = generateExtrudedWall(
          { ...wall, height },
          [],
          calculateLevelMiters(walls),
          support.elevation,
          support.baseElevation,
          support.baseSegments,
          3,
          undefined,
          support.faceDatum,
        )
        const material = new MeshBasicMaterial({ side: DoubleSide })
        const mesh = new Mesh(geometry, material)
        mesh.position.y = support.elevation
        mesh.updateMatrixWorld(true)
        for (const fraction of [0.125, 0.25, 0.375, 0.75, 0.875])
          for (const z of [-0.05, 0.05]) {
            const dx = wall.end[0] - wall.start[0],
              dz = wall.end[1] - wall.start[1]
            const length = Math.hypot(dx, dz),
              x = fraction * length
            const outerWorldX = wall.start[0] + fraction * dx + ((dz / length) * wall.thickness) / 2
            const ray = new Raycaster(new Vector3(x, -1, z), new Vector3(0, 1, 0))
            const bottom = ray.intersectObject(mesh)[0]!
            expect(bottom.point.y).toBeCloseTo(
              z > 0 ? 0.6 : terrain ? 0.12 + outerWorldX * 0.02 : 0,
              4,
            )
            ray.ray.origin.y = 5
            ray.ray.direction.y = -1
            expect(ray.intersectObject(mesh)[0]!.point.y).toBeCloseTo(
              height === undefined ? 3 : height + support.elevation,
            )
          }
        geometry.dispose()
        material.dispose()
      }
    }
  })

test('raised exterior door keeps the wall upstand below its high sill', () => {
  const { walls, slabs, nodes, door, level } = raisedRoomFixture()
  const wall = walls[0]!
  const opening = { ...door, wallId: wall.id, parentId: wall.id }
  const support = computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)
  const registered = new Mesh()
  sceneRegistry.nodes.set(wall.id, registered)
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const geometry = generateExtrudedWall(
    wall,
    [opening],
    calculateLevelMiters(walls),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    3,
    undefined,
    support.faceDatum,
    undefined,
    { [level.id]: { ...level, height: 3 } },
  )
  const mesh = new Mesh(geometry, material)
  mesh.position.y = support.elevation
  mesh.updateMatrixWorld(true)
  try {
    const ray = new Raycaster(new Vector3(2, 0.3, -1), new Vector3(0, 0, 1))
    expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
    ray.ray.origin.x = 1
    expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
    expect(opening.position[1] - opening.height / 2 + support.elevation).toBe(0.6)
  } finally {
    sceneRegistry.nodes.delete(wall.id)
    registered.geometry.dispose()
    geometry.dispose()
    material.dispose()
  }
})

test('shared wall keeps its complete body behind a raised floor', () => {
  const { divider, walls, slabs, nodes } = raisedRoomFixture(true)
  const support = computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, nodes)
  const geometry = generateExtrudedWall(
    divider,
    [],
    calculateLevelMiters(walls),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    3,
    undefined,
    support.faceDatum,
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.position.y = support.elevation
  mesh.updateMatrixWorld(true)
  try {
    for (const x of [0.5, 2, 3.5])
      for (const z of [-0.05, 0.05]) {
        const ray = new Raycaster(new Vector3(x, -1, z), new Vector3(0, 1, 0))
        expect(ray.intersectObject(mesh)[0]!.point.y).toBeCloseTo(0.05, 5)
        ray.ray.origin.y = 4
        ray.ray.direction.y = -1
        expect(ray.intersectObject(mesh)[0]!.point.y).toBeCloseTo(3)
      }
  } finally {
    geometry.dispose()
    material.dispose()
  }
})

test('platform wall bottoms remain closed across changing terrain slopes', () => {
  const { walls, slabs, nodes, site, level } = raisedRoomFixture(false, true)
  const field = createTerrainField({ origin: [-1, -1], cols: 12, rows: 8, spacing: 1 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      field.heights[row * field.cols + col] = 10 + (col % 3) * 8
  nodes[site.id] = { ...site, terrain: encodeTerrainField(field) }
  const wall = walls[0]!
  const support = computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)
  const geometry = generateExtrudedWall(
    wall,
    [],
    calculateLevelMiters(walls),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    3,
    undefined,
    support.faceDatum,
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.position.y = support.elevation
  mesh.updateMatrixWorld(true)
  try {
    for (let step = 1; step < 32; step++) {
      const x = step / 4
      const ray = new Raycaster(new Vector3(x, -1, -0.05), new Vector3(0, 1, 0))
      expect(ray.intersectObject(mesh)[0]!.point.y).toBeCloseTo(
        levelBaseElevationAt(nodes, level.id, x, -0.1),
        4,
      )
    }
  } finally {
    geometry.dispose()
    material.dispose()
  }
})

for (const height of [0.3, 0.6, 1])
  test(`interior half wall keeps its ${height} m height on a raised room floor`, () => {
    const fixture = raisedRoomFixture()
    const wall = {
      ...fixture.walls[0]!,
      id: 'wall_platform_half' as const,
      start: [1, 2] as [number, number],
      end: [3, 2] as [number, number],
      height,
    }
    const walls = [...fixture.walls, wall]
    const nodes = { ...fixture.nodes, [wall.id]: wall }
    const support = computeWallSlabSupport(
      wall,
      fixture.slabs,
      walls,
      undefined,
      undefined,
      0,
      nodes,
    )
    const geometry = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters(walls),
      support.elevation,
      support.baseElevation,
      support.baseSegments,
      3,
      undefined,
      support.faceDatum,
    )
    geometry.computeBoundingBox()
    expect(support.faceDatum.a).toEqual(support.faceDatum.b)
    expect(geometry.boundingBox!.min.y + support.elevation).toBeCloseTo(0.6)
    expect(geometry.boundingBox!.max.y + support.elevation).toBeCloseTo(0.6 + height)
    geometry.dispose()
  })

test('legacy sunken support bounds both geometry bottoms by W', () => {
  const fixture = raisedRoomFixture()
  const slabs = fixture.slabs.map((slab) => ({ ...slab, elevation: -0.4 }))
  const nodes = { ...fixture.nodes, ...Object.fromEntries(slabs.map((slab) => [slab.id, slab])) }
  const wall = fixture.walls[0]!
  const support = computeWallSlabSupport(wall, slabs, fixture.walls, undefined, undefined, 0, nodes)
  expect(support.faceDatum.a).toEqual([{ start: 0, end: 1, elevation: -0.4 }])
  expect(support.faceDatum.b).toEqual([{ start: 0, end: 1, elevation: 0 }])
  const geometry = generateExtrudedWall(
    wall,
    [],
    calculateLevelMiters(fixture.walls),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    3,
    undefined,
    support.faceDatum,
  )
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.position.y = support.elevation
  mesh.updateMatrixWorld(true)
  for (const z of [-0.05, 0.05]) {
    const ray = new Raycaster(new Vector3(2, -1, z), new Vector3(0, 1, 0))
    expect(ray.intersectObject(mesh)[0]!.point.y).toBeCloseTo(-0.4)
  }
  geometry.dispose()
  material.dispose()
})
