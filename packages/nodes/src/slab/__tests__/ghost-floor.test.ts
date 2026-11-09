import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  area,
  calculateLevelMiters,
  computePlateSurfacePartition,
  type GeometryContext,
  plateLevelContext,
  slabPolygonContextFromGeometry,
  useScene,
} from '@pascal-app/core'
import { generateSlabGeometry } from '@pascal-app/viewer'
import { type BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { generateExtrudedWall } from '../../../../viewer/src/systems/wall/wall-system'
import saved from '../__fixtures__/ghost-scene.json'
import { buildSlabGeometry } from '../geometry'
import { splitPlateFaces } from '../surface-split'

let previous: ReturnType<typeof useScene.getState>
const geometries: BufferGeometry[] = []
beforeEach(async () => {
  previous = useScene.getState()
  useScene
    .getState()
    .setScene(
      saved.nodes as unknown as Record<AnyNodeId, AnyNode>,
      saved.rootNodeIds as AnyNodeId[],
    )
  await new Promise<void>((resolve) => queueMicrotask(resolve))
})
afterEach(() => {
  for (const geometry of geometries.splice(0)) geometry.dispose()
  useScene.setState(previous, true)
})

function topTriangles(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  let count = 0
  let area = 0
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const a = index ? index.getX(i) : i
    const b = index ? index.getX(i + 1) : i + 1
    const c = index ? index.getX(i + 2) : i + 2
    const normalY =
      (position.getZ(b) - position.getZ(a)) * (position.getX(c) - position.getX(a)) -
      (position.getX(b) - position.getX(a)) * (position.getZ(c) - position.getZ(a))
    if (normalY > 1e-8) {
      count++
      area += normalY / 2
    }
  }
  return { count, area }
}

function plateMeshes(id: string) {
  const nodes = useScene.getState().nodes
  const slab = nodes[id]!
  if (slab.type !== 'slab') throw new Error(`Missing plate ${id}`)
  const ctx: GeometryContext = {
    parent: nodes[slab.parentId!],
    children: [],
    siblings: Object.values(nodes).filter((n) => n.parentId === slab.parentId && n.id !== id),
    resolve: <N = AnyNode>(nodeId: AnyNodeId) => nodes[nodeId] as N | undefined,
  }
  const group = buildSlabGeometry(slab, ctx, 'rendered', true)
  const meshes = group.children.filter((child): child is Mesh => child instanceof Mesh)
  geometries.push(...meshes.map((mesh) => mesh.geometry))
  group.updateMatrixWorld(true)
  return { slab, ctx, meshes }
}

const cases = [
  {
    name: 'L-shaped room',
    id: 'slab_eqf6q9hodn5tsf3o',
    points: [
      [-6, -3],
      [-2, -5],
    ],
  },
  {
    name: 'separator Divide halves',
    id: 'slab_uib9i6m6gkr5xtyk',
    points: [
      [2, -4],
      [6, -4],
    ],
  },
  {
    name: 'square with separator island',
    id: 'slab_dtt1jagvh3yqnfdx',
    points: [
      [-6, 2],
      [-4, 4],
    ],
  },
  { name: 'curved room', id: 'slab_703pibzbqnyn4m5s', points: [[3, 3]] },
]

for (const probe of cases) {
  test(`stored ghost scene: ${probe.name} retains rendered floor after hydration`, () => {
    const { slab, ctx, meshes } = plateMeshes(probe.id)
    const source = saved.nodes[probe.id as keyof typeof saved.nodes]
    expect(slab.elevation).toBe('elevation' in source ? source.elevation : 0.05)
    expect(
      slab.plateRole === 'base' ||
        (slab.plateRole === undefined && (slab.associatedZoneIds?.length ?? 0) > 0),
    ).toBe(true)
    const partition = computePlateSurfacePartition(
      slab,
      plateLevelContext(ctx.parent!, ctx.resolve),
    )
    const expectedArea = area([{ outer: slab.polygon, holes: slab.holes }])
    if (slab.plateRole === 'base') {
      expect(partition).not.toBeNull()
      expect(area(partition!.masked)).toBe(0)
      expect(partition!.cells.reduce((sum, cell) => sum + area(cell.polygons), 0)).toBeCloseTo(
        expectedArea,
        5,
      )
    } else expect(partition).toBeNull()
    const raw = generateSlabGeometry(slab, slabPolygonContextFromGeometry(ctx))
    const split = partition ? splitPlateFaces(raw, partition, slab) : []
    geometries.push(raw, ...split.map((bucket) => bucket.geometry))
    for (const stage of [
      [raw],
      ...(partition ? [split.map((bucket) => bucket.geometry)] : []),
      meshes.map((mesh) => mesh.geometry),
    ]) {
      const tops = stage.map(topTriangles)
      expect(tops.reduce((sum, top) => sum + top.count, 0)).toBeGreaterThan(0)
      const renderedArea = tops.reduce((sum, top) => sum + top.area, 0)
      if (slab.plateRole === 'base') expect(renderedArea).toBeCloseTo(expectedArea, 4)
      else expect(Math.abs(renderedArea - expectedArea)).toBeLessThan(0.005)
    }
    for (const [x, z] of probe.points) {
      const ray = new Raycaster(new Vector3(x, 10, z), new Vector3(0, -1, 0))
      const hit = ray.intersectObjects(meshes)[0]!
      expect(hit).toBeDefined()
      expect(hit.object.userData.slotId).toMatch(slab.plateRole === 'base' ? /^room:/ : /^surface$/)
      expect(hit.point.y).toBeCloseTo(slab.elevation, 6)
    }
  })
}

test('stored ghost scene: full-height walls occlude the back floors from the initial camera', () => {
  const nodes = useScene.getState().nodes
  const walls = Object.values(nodes).filter((node) => node.type === 'wall')
  const miters = calculateLevelMiters(walls)
  const material = new MeshBasicMaterial()
  try {
    const wallMeshes = walls.map((wall) => {
      const geometry = generateExtrudedWall(wall, [], miters, 0.05, 0.05, undefined, 2.5)
      geometries.push(geometry)
      const mesh = new Mesh(geometry, material)
      mesh.position.set(wall.start[0], 0.05, wall.start[1])
      mesh.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
      mesh.updateMatrixWorld(true)
      return mesh
    })
    for (const probe of cases.slice(0, 2)) {
      const { slab, meshes } = plateMeshes(probe.id)
      const [x, z] = probe.points[0]!
      const target = new Vector3(x, 0.05, z)
      const origin = new Vector3(10, 10, 10)
      const ray = new Raycaster(origin, target.clone().sub(origin).normalize())
      const floorHit = ray.intersectObjects(meshes)[0]!
      const wallHit = ray.intersectObjects(wallMeshes)[0]!
      expect(floorHit).toBeDefined()
      expect(wallHit.distance).toBeLessThan(floorHit.distance)
      ray.set(new Vector3(x, 10, z), new Vector3(0, -1, 0))
      expect(ray.intersectObjects(wallMeshes)).toHaveLength(0)
      expect(ray.intersectObjects(meshes)[0]!.object.userData.slotId).toMatch(
        slab.plateRole === 'base' ? /^room:/ : /^surface$/,
      )
    }
  } finally {
    material.dispose()
  }
})
