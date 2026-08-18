import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  getRoofSegmentSurfaceY,
  LeanToExtensionNode,
  WallNode,
} from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import * as THREE from 'three'
import { computeGutterMitres, type GutterMitres } from '../gutter/corner-mitre'
import { buildGutterGeometry } from '../gutter/geometry'
import { createLeanToAssembly, leanToCornerPostIndex, managedLeanToPostIndex } from './assembly'
import { resolveLeanToCornerJoints } from './corner-joint'

function cornerFixture(reverseWalls = false, sideOverhang = 0) {
  const wallA = WallNode.parse({
    id: 'wall_corner_a',
    parentId: 'level_corner',
    start: reverseWalls ? [4, 0] : [0, 0],
    end: reverseWalls ? [0, 0] : [4, 0],
  })
  const wallB = WallNode.parse({
    id: 'wall_corner_b',
    parentId: 'level_corner',
    start: reverseWalls ? [4, -4] : [4, 0],
    end: reverseWalls ? [4, 0] : [4, -4],
  })
  const leanToA = LeanToExtensionNode.parse({
    id: 'leanto_corner_a',
    parentId: wallA.id,
    position: [2, 0, reverseWalls ? -0.05 : 0.05],
    rotation: [0, reverseWalls ? Math.PI : 0, 0],
    span: 4,
    leftOverhang: sideOverhang,
    rightOverhang: sideOverhang,
  })
  const leanToB = LeanToExtensionNode.parse({
    id: 'leanto_corner_b',
    parentId: wallB.id,
    position: [2, 0, reverseWalls ? -0.05 : 0.05],
    rotation: [0, reverseWalls ? Math.PI : 0, 0],
    span: 4,
    highEdgeHeight: 3.1,
    pitch: 16,
    leftOverhang: sideOverhang,
    rightOverhang: sideOverhang,
  })
  const nodes = Object.fromEntries(
    [wallA, wallB, leanToA, leanToB].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  return { wallA, wallB, leanToA, leanToB, nodes }
}

function angledCornerFixture(interiorAngleDegrees: number) {
  const corner: [number, number] = [4, 0]
  const radians = (interiorAngleDegrees * Math.PI) / 180
  const wallA = WallNode.parse({
    id: 'wall_angled_corner_a',
    parentId: 'level_angled_corner',
    start: [0, 0],
    end: corner,
  })
  const wallB = WallNode.parse({
    id: 'wall_angled_corner_b',
    parentId: 'level_angled_corner',
    start: corner,
    end: [corner[0] - 4 * Math.cos(radians), -4 * Math.sin(radians)],
  })
  const leanToA = LeanToExtensionNode.parse({
    id: 'leanto_angled_corner_a',
    parentId: wallA.id,
    position: [2, 0, 0.05],
    span: 4,
  })
  const leanToB = LeanToExtensionNode.parse({
    id: 'leanto_angled_corner_b',
    parentId: wallB.id,
    position: [2, 0, 0.05],
    span: 4,
    highEdgeHeight: 3.1,
    pitch: 16,
  })
  const nodes = Object.fromEntries(
    [wallA, wallB, leanToA, leanToB].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  return { wallA, wallB, leanToA, leanToB, nodes }
}

const continuousSupportedAngles = [
  ...Array.from({ length: 121 }, (_, index) => 30 + index),
  30.25,
  44.3,
  67.75,
  89.9,
  90.1,
  113.5,
  149.75,
]

function segmentWorldMatrix(
  wall: ReturnType<typeof WallNode.parse>,
  leanTo: ReturnType<typeof LeanToExtensionNode.parse>,
  segment: ReturnType<typeof createLeanToAssembly>['segment'],
) {
  const wallAngle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  return new THREE.Matrix4()
    .makeTranslation(wall.start[0], 0, wall.start[1])
    .multiply(new THREE.Matrix4().makeRotationY(-wallAngle))
    .multiply(new THREE.Matrix4().makeTranslation(...leanTo.position))
    .multiply(new THREE.Matrix4().makeRotationY(leanTo.rotation[1]))
    .multiply(new THREE.Matrix4().makeTranslation(...segment.position))
    .multiply(new THREE.Matrix4().makeRotationY(segment.rotation))
}

function cornerPlanPointToWorld(
  wall: ReturnType<typeof WallNode.parse>,
  leanTo: ReturnType<typeof LeanToExtensionNode.parse>,
  point: readonly [number, number],
) {
  const wallAngle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  return new THREE.Vector3(point[0], 0, point[1]).applyMatrix4(
    new THREE.Matrix4()
      .makeTranslation(wall.start[0], 0, wall.start[1])
      .multiply(new THREE.Matrix4().makeRotationY(-wallAngle))
      .multiply(new THREE.Matrix4().makeTranslation(...leanTo.position))
      .multiply(new THREE.Matrix4().makeRotationY(leanTo.rotation[1])),
  )
}

function pointSetHausdorffDistance(left: THREE.Vector3[], right: THREE.Vector3[]): number {
  const directed = (source: THREE.Vector3[], target: THREE.Vector3[]) =>
    Math.max(
      ...source.map((point) => Math.min(...target.map((candidate) => point.distanceTo(candidate)))),
    )
  return Math.max(directed(left, right), directed(right, left))
}

function pointInPolygon(point: readonly [number, number], polygon: THREE.Vector3[]): boolean {
  let inside = false
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const a = polygon[current]!
    const b = polygon[previous]!
    if (
      a.z > point[1] !== b.z > point[1] &&
      point[0] < ((b.x - a.x) * (point[1] - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

function assertTopGeometryFollowsRoofSlab(
  geometry: THREE.BufferGeometry,
  segment: ReturnType<typeof createLeanToAssembly>['segment'],
) {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  if (!index) throw new Error('expected indexed roof geometry')
  const { cosTheta } = getSegmentSlopeFrameForTest(segment)
  const thickness =
    segment.deckThickness / Math.max(0.1, cosTheta) + segment.shingleThickness * cosTheta
  for (const group of geometry.groups) {
    if (group.materialIndex !== 3) continue
    const end = Math.min(index.count, group.start + group.count)
    for (let offset = group.start; offset < end; offset++) {
      const vertex = index.getX(offset)
      const x = position.getX(vertex)
      const y = position.getY(vertex)
      const z = position.getZ(vertex)
      const top = getRoofSegmentSurfaceY(segment, x, z) + thickness
      expect(y).toBeCloseTo(top, 4)
    }
  }
}

function getSegmentSlopeFrameForTest(segment: ReturnType<typeof createLeanToAssembly>['segment']) {
  const radians = (segment.pitch * Math.PI) / 180
  return { cosTheta: Math.cos(radians) }
}

function countTopMaterialVerticalTriangles(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  if (!index) return 0
  let count = 0
  for (const group of geometry.groups) {
    if (group.materialIndex !== 3) continue
    const end = Math.min(index.count, group.start + group.count)
    for (let offset = group.start; offset + 2 < end; offset += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset))
      const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset + 1))
      const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(offset + 2))
      const normal = b.sub(a).cross(c.sub(a)).normalize()
      if (normal.y < 0.2) count++
    }
  }
  return count
}

function gutterWorldGeometry(
  wall: ReturnType<typeof WallNode.parse>,
  leanTo: ReturnType<typeof LeanToExtensionNode.parse>,
  assembly: ReturnType<typeof createLeanToAssembly>,
  mitres: GutterMitres,
) {
  const geometry = buildGutterGeometry(
    { ...assembly.gutter, hangerStyle: 'none', outlets: [] },
    mitres,
  )
  const transform = segmentWorldMatrix(wall, leanTo, assembly.segment)
    .multiply(new THREE.Matrix4().makeTranslation(...assembly.gutter.position))
    .multiply(new THREE.Matrix4().makeRotationY(assembly.gutter.rotation))
  return geometry.applyMatrix4(transform)
}

function closestMeshDistance(source: THREE.BufferGeometry, target: THREE.BufferGeometry): number {
  const sourcePosition = source.getAttribute('position')
  const targetPosition = target.getAttribute('position')
  const targetIndex = target.index
  const targetVertexCount = targetIndex?.count ?? targetPosition.count
  const targetVertex = (offset: number) => targetIndex?.getX(offset) ?? offset
  const point = new THREE.Vector3()
  const closest = new THREE.Vector3()
  const triangle = new THREE.Triangle()
  let minimum = Number.POSITIVE_INFINITY
  for (let sourceIndex = 0; sourceIndex < sourcePosition.count; sourceIndex++) {
    point.fromBufferAttribute(sourcePosition, sourceIndex)
    for (let offset = 0; offset < targetVertexCount; offset += 3) {
      triangle.a.fromBufferAttribute(targetPosition, targetVertex(offset))
      triangle.b.fromBufferAttribute(targetPosition, targetVertex(offset + 1))
      triangle.c.fromBufferAttribute(targetPosition, targetVertex(offset + 2))
      triangle.closestPointToPoint(point, closest)
      minimum = Math.min(minimum, point.distanceTo(closest))
    }
  }
  return minimum
}

function contactingVertices(source: THREE.BufferGeometry, target: THREE.BufferGeometry) {
  const sourcePosition = source.getAttribute('position')
  const targetPosition = target.getAttribute('position')
  const targetIndex = target.index
  const targetVertexCount = targetIndex?.count ?? targetPosition.count
  const targetVertex = (offset: number) => targetIndex?.getX(offset) ?? offset
  const point = new THREE.Vector3()
  const closest = new THREE.Vector3()
  const triangle = new THREE.Triangle()
  const contacts: number[][] = []
  for (let sourceIndex = 0; sourceIndex < sourcePosition.count; sourceIndex++) {
    point.fromBufferAttribute(sourcePosition, sourceIndex)
    let minimum = Number.POSITIVE_INFINITY
    for (let offset = 0; offset < targetVertexCount; offset += 3) {
      triangle.a.fromBufferAttribute(targetPosition, targetVertex(offset))
      triangle.b.fromBufferAttribute(targetPosition, targetVertex(offset + 1))
      triangle.c.fromBufferAttribute(targetPosition, targetVertex(offset + 2))
      triangle.closestPointToPoint(point, closest)
      minimum = Math.min(minimum, point.distanceTo(closest))
    }
    if (minimum < 1e-4) contacts.push(point.toArray())
  }
  return contacts
}

describe('lean-to corner joint', () => {
  test('resolves a reciprocal 60 degree corner with its true gutter mitre', () => {
    const { wallA, wallB, leanToA, leanToB, nodes } = angledCornerFixture(60)

    const jointA = resolveLeanToCornerJoints(leanToA, wallA, nodes).right
    const jointB = resolveLeanToCornerJoints(leanToB, wallB, nodes).left

    expect(jointA?.neighborId).toBe(leanToB.id)
    expect(jointB?.neighborId).toBe(leanToA.id)
    expect(jointA?.neighborSide).toBe('left')
    expect(jointB?.neighborSide).toBe('right')
    expect(jointA?.gutterMitre).toBeCloseTo(Math.PI / 3, 8)
    expect(jointB?.gutterMitre).toBeCloseTo(Math.PI / 3, 8)
    expect(jointA?.roofExtension).toBeGreaterThan(0)
    expect(jointB?.roofExtension).toBeGreaterThan(0)
  })

  test('resolves acute and obtuse corner angles without reverting to a 45 degree cut', () => {
    for (const angle of [30, 45, 75, 105, 120, 135, 150]) {
      const { wallA, wallB, leanToA, leanToB, nodes } = angledCornerFixture(angle)
      const jointA = resolveLeanToCornerJoints(leanToA, wallA, nodes).right
      const jointB = resolveLeanToCornerJoints(leanToB, wallB, nodes).left
      const expectedMitre = ((180 - angle) * Math.PI) / 360

      expect(jointA?.neighborId).toBe(leanToB.id)
      expect(jointB?.neighborId).toBe(leanToA.id)
      expect(jointA?.gutterMitre).toBeCloseTo(expectedMitre, 8)
      expect(jointB?.gutterMitre).toBeCloseTo(expectedMitre, 8)
      expect(Number(jointA?.sharedPostOwner) + Number(jointB?.sharedPostOwner)).toBe(1)
      const postA = cornerPlanPointToWorld(wallA, leanToA, [
        jointA!.sharedPostPosition[0],
        jointA!.sharedPostPosition[2],
      ])
      const postB = cornerPlanPointToWorld(wallB, leanToB, [
        jointB!.sharedPostPosition[0],
        jointB!.sharedPostPosition[2],
      ])
      expect(postA.distanceTo(postB)).toBeLessThan(1e-6)
    }
  })

  test('keeps the complete roof, gutter, beam, and shared-post joint continuous at every supported angle', () => {
    for (const angle of continuousSupportedAngles) {
      const { wallA, wallB, leanToA, leanToB, nodes } = angledCornerFixture(angle)
      const jointA = resolveLeanToCornerJoints(leanToA, wallA, nodes).right
      const jointB = resolveLeanToCornerJoints(leanToB, wallB, nodes).left
      const expectedMitre = ((180 - angle) * Math.PI) / 360

      expect(jointA?.gutterMitre).toBeCloseTo(expectedMitre, 8)
      expect(jointB?.gutterMitre).toBeCloseTo(expectedMitre, 8)
      expect(jointA?.roofPiece.length).toBeGreaterThanOrEqual(3)
      expect(jointB?.roofPiece.length).toBeGreaterThanOrEqual(3)
      expect(jointA?.beamExtension).toBeGreaterThan(0)
      expect(jointB?.beamExtension).toBeGreaterThan(0)

      const seamA = jointA?.seam?.map((point) => cornerPlanPointToWorld(wallA, leanToA, point))
      const seamB = jointB?.seam?.map((point) => cornerPlanPointToWorld(wallB, leanToB, point))
      expect(seamA).toHaveLength(2)
      expect(seamB).toHaveLength(2)
      expect(pointSetHausdorffDistance(seamA!, seamB!)).toBeLessThan(1e-5)

      const postA = cornerPlanPointToWorld(wallA, leanToA, [
        jointA!.sharedPostPosition[0],
        jointA!.sharedPostPosition[2],
      ])
      const postB = cornerPlanPointToWorld(wallB, leanToB, [
        jointB!.sharedPostPosition[0],
        jointB!.sharedPostPosition[2],
      ])
      expect(postA.distanceTo(postB)).toBeLessThan(1e-6)

      const assemblyA = createLeanToAssembly(leanToA, undefined, nodes)
      const assemblyB = createLeanToAssembly(leanToB, undefined, nodes)
      const gutterA = gutterWorldGeometry(
        wallA,
        leanToA,
        assemblyA,
        computeGutterMitres(assemblyA.gutter, assemblyA.segment, [
          { gutter: assemblyB.gutter, segment: assemblyB.segment },
        ]),
      )
      const gutterB = gutterWorldGeometry(
        wallB,
        leanToB,
        assemblyB,
        computeGutterMitres(assemblyB.gutter, assemblyB.segment, [
          { gutter: assemblyA.gutter, segment: assemblyA.segment },
        ]),
      )
      expect(contactingVertices(gutterA, gutterB).length).toBeGreaterThan(10)
      expect(contactingVertices(gutterB, gutterA).length).toBeGreaterThan(10)
      expect(
        [...assemblyA.posts, ...assemblyB.posts].filter((post) => {
          const index = managedLeanToPostIndex(post)
          return index === leanToCornerPostIndex('left') || index === leanToCornerPostIndex('right')
        }),
      ).toHaveLength(1)
      gutterA.dispose()
      gutterB.dispose()
    }
  })

  test('rejects corners immediately outside the supported 30 to 150 degree range', () => {
    for (const angle of [20, 29.99, 150.01, 160]) {
      const { wallA, wallB, leanToA, leanToB, nodes } = angledCornerFixture(angle)
      expect(resolveLeanToCornerJoints(leanToA, wallA, nodes)).toEqual({})
      expect(resolveLeanToCornerJoints(leanToB, wallB, nodes)).toEqual({})
    }
  })

  test('joins both rendered gutter shells across acute and obtuse corners', () => {
    for (const angle of [30, 45, 60, 75, 105, 120, 135, 150]) {
      const { wallA, wallB, leanToA, leanToB, nodes } = angledCornerFixture(angle)
      const assemblyA = createLeanToAssembly(leanToA, undefined, nodes)
      const assemblyB = createLeanToAssembly(leanToB, undefined, nodes)
      const mitresA = computeGutterMitres(assemblyA.gutter, assemblyA.segment, [
        { gutter: assemblyB.gutter, segment: assemblyB.segment },
      ])
      const mitresB = computeGutterMitres(assemblyB.gutter, assemblyB.segment, [
        { gutter: assemblyA.gutter, segment: assemblyA.segment },
      ])
      const gutterA = gutterWorldGeometry(wallA, leanToA, assemblyA, mitresA)
      const gutterB = gutterWorldGeometry(wallB, leanToB, assemblyB, mitresB)
      const contactsA = contactingVertices(gutterA, gutterB)
      const contactsB = contactingVertices(gutterB, gutterA)

      expect(contactsA.length).toBeGreaterThan(10)
      expect(contactsB.length).toBeGreaterThan(10)
      gutterA.dispose()
      gutterB.dispose()
    }
  })

  test('gives unequal roofs one coincident world seam across supported angles', () => {
    for (const angle of [30, 45, 60, 75, 105, 120, 135, 150]) {
      const { wallA, wallB, leanToA, leanToB, nodes } = angledCornerFixture(angle)
      const jointA = resolveLeanToCornerJoints(leanToA, wallA, nodes).right!
      const jointB = resolveLeanToCornerJoints(leanToB, wallB, nodes).left!
      const seamA = jointA.seam?.map((point) => cornerPlanPointToWorld(wallA, leanToA, point))
      const seamB = jointB.seam?.map((point) => cornerPlanPointToWorld(wallB, leanToB, point))

      expect(jointA.roofPiece.length).toBeGreaterThanOrEqual(3)
      expect(jointB.roofPiece.length).toBeGreaterThanOrEqual(3)
      expect(seamA).toHaveLength(2)
      expect(seamB).toHaveLength(2)
      expect(pointSetHausdorffDistance(seamA!, seamB!)).toBeLessThan(1e-5)
    }
  })

  test('partitions the shared 60 degree roof-corner patch exactly once', () => {
    const { wallA, wallB, leanToA, leanToB, nodes } = angledCornerFixture(60)
    const assemblies = [
      { wall: wallA, leanTo: leanToA, assembly: createLeanToAssembly(leanToA, undefined, nodes) },
      { wall: wallB, leanTo: leanToB, assembly: createLeanToAssembly(leanToB, undefined, nodes) },
    ]
    const meshes = assemblies.map(({ wall, leanTo, assembly }) => {
      const matrix = segmentWorldMatrix(wall, leanTo, assembly.segment)
      return new THREE.Mesh(generateRoofSegmentGeometry(assembly.segment).applyMatrix4(matrix))
    })
    const expectedFootprints = assemblies.map(({ wall, leanTo, assembly }) => {
      const matrix = segmentWorldMatrix(wall, leanTo, assembly.segment)
      const halfWidth = assembly.segment.width / 2
      const halfDepth = assembly.segment.depth / 2
      return [
        new THREE.Vector3(-halfWidth, 0, -halfDepth).applyMatrix4(matrix),
        new THREE.Vector3(halfWidth, 0, -halfDepth).applyMatrix4(matrix),
        new THREE.Vector3(halfWidth, 0, halfDepth).applyMatrix4(matrix),
        new THREE.Vector3(-halfWidth, 0, halfDepth).applyMatrix4(matrix),
      ]
    })
    const bounds = new THREE.Box3().setFromPoints(expectedFootprints.flat())
    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    const uncovered: [number, number][] = []
    const overlaps: [number, number][] = []
    for (let x = bounds.min.x + 0.037; x < bounds.max.x; x += 0.08) {
      for (let z = bounds.min.z + 0.053; z < bounds.max.z; z += 0.08) {
        if (!expectedFootprints.every((polygon) => pointInPolygon([x, z], polygon))) continue
        raycaster.ray.origin.set(x, 10, z)
        const owners = meshes.filter((mesh) => raycaster.intersectObject(mesh, false).length > 0)
        if (owners.length === 0) uncovered.push([x, z])
        if (owners.length > 1) overlaps.push([x, z])
      }
    }

    expect(uncovered).toEqual([])
    expect(overlaps).toEqual([])
    for (const mesh of meshes) mesh.geometry.dispose()
  })

  test('drives roof, gutters, beam support, and one shared pillar from one joint', () => {
    const { wallA, wallB, leanToA, leanToB, nodes } = cornerFixture()
    const jointsA = resolveLeanToCornerJoints(leanToA, wallA, nodes)
    const jointsB = resolveLeanToCornerJoints(leanToB, wallB, nodes)
    const jointA = jointsA.right!
    const jointB = jointsB.left!

    expect(jointA.neighborId).toBe(leanToB.id)
    expect(jointB.neighborId).toBe(leanToA.id)
    expect(jointA.roofPiece.length).toBeGreaterThanOrEqual(3)
    expect(jointB.roofPiece.length).toBeGreaterThanOrEqual(3)
    expect(jointA.seam).not.toBeNull()
    expect(jointB.seam).not.toBeNull()
    expect(Number(jointA.sharedPostOwner) + Number(jointB.sharedPostOwner)).toBe(1)

    const assemblyA = createLeanToAssembly(leanToA, undefined, nodes)
    const assemblyB = createLeanToAssembly(leanToB, undefined, nodes)
    expect(assemblyA.segment.trim.backRightX).toBe(0)
    expect(assemblyB.segment.trim.backLeftX).toBe(0)
    expect(assemblyA.segment.shedFootprintPieces).toHaveLength(2)
    expect(assemblyB.segment.shedFootprintPieces).toHaveLength(2)
    expect(assemblyA.gutter.metadata).toMatchObject({
      leanToGutterMitres: { left: 0, right: Math.PI / 4 },
    })
    expect(assemblyB.gutter.metadata).toMatchObject({
      leanToGutterMitres: { left: Math.PI / 4, right: 0 },
    })
    const sharedPosts = [...assemblyA.posts, ...assemblyB.posts].filter((post) => {
      const index = managedLeanToPostIndex(post)
      return index === leanToCornerPostIndex('left') || index === leanToCornerPostIndex('right')
    })
    expect(sharedPosts).toHaveLength(1)
  })

  test('renders a continuous unequal-pitch L without detached rectangular strips', () => {
    const { wallA, wallB, leanToA, leanToB, nodes } = cornerFixture()
    const segmentA = createLeanToAssembly(leanToA, undefined, nodes).segment
    const segmentB = createLeanToAssembly(leanToB, undefined, nodes).segment
    const localGeometries = [
      generateRoofSegmentGeometry(segmentA),
      generateRoofSegmentGeometry(segmentB),
    ]

    assertTopGeometryFollowsRoofSlab(localGeometries[0]!, segmentA)
    assertTopGeometryFollowsRoofSlab(localGeometries[1]!, segmentB)
    expect(countTopMaterialVerticalTriangles(localGeometries[0]!)).toBe(0)
    expect(countTopMaterialVerticalTriangles(localGeometries[1]!)).toBe(0)

    const meshes = [
      new THREE.Mesh(
        localGeometries[0]!.clone().applyMatrix4(segmentWorldMatrix(wallA, leanToA, segmentA)),
      ),
      new THREE.Mesh(
        localGeometries[1]!.clone().applyMatrix4(segmentWorldMatrix(wallB, leanToB, segmentB)),
      ),
    ]
    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    const uncovered: [number, number][] = []
    const overlaps: [number, number][] = []
    const samples = new Map<string, { owner: number; height: number }>()

    for (let xIndex = 0; xIndex <= 23; xIndex++) {
      const x = 4.15 + xIndex * 0.1
      for (let zIndex = 0; zIndex <= 23; zIndex++) {
        const z = 0.15 + zIndex * 0.1
        raycaster.ray.origin.set(x, 10, z)
        const hits = meshes.map((mesh) => raycaster.intersectObject(mesh, false)[0])
        const owners = hits.flatMap((hit, owner) => (hit ? [owner] : []))
        if (owners.length === 0) uncovered.push([x, z])
        if (owners.length > 1) overlaps.push([x, z])
        if (owners.length === 1) {
          const owner = owners[0]!
          samples.set(`${xIndex}:${zIndex}`, { owner, height: hits[owner]!.point.y })
        }
      }
    }

    let transitions = 0
    const separatedTransitions: number[] = []
    for (let xIndex = 0; xIndex <= 23; xIndex++) {
      for (let zIndex = 0; zIndex <= 23; zIndex++) {
        const sample = samples.get(`${xIndex}:${zIndex}`)
        if (!sample) continue
        for (const key of [`${xIndex + 1}:${zIndex}`, `${xIndex}:${zIndex + 1}`]) {
          const neighbor = samples.get(key)
          if (!neighbor || neighbor.owner === sample.owner) continue
          transitions++
          const delta = Math.abs(neighbor.height - sample.height)
          if (delta > 0.05) separatedTransitions.push(delta)
        }
      }
    }

    expect(uncovered).toEqual([])
    expect(overlaps).toEqual([])
    expect(transitions).toBeGreaterThan(0)
    expect(separatedTransitions).toEqual([])
    for (const geometry of localGeometries) geometry.dispose()
    for (const mesh of meshes) mesh.geometry.dispose()
  })

  test('joins both rendered gutter shells at the corner', () => {
    for (const [reverseWalls, sideOverhang] of [
      [false, 0],
      [true, 0],
      [false, 0.3],
      [true, 0.3],
    ] as const) {
      const { wallA, wallB, leanToA, leanToB, nodes } = cornerFixture(reverseWalls, sideOverhang)
      const assemblyA = createLeanToAssembly(leanToA, undefined, nodes)
      const assemblyB = createLeanToAssembly(leanToB, undefined, nodes)
      const mitresA = computeGutterMitres(assemblyA.gutter, assemblyA.segment, [
        { gutter: assemblyB.gutter, segment: assemblyB.segment },
      ])
      const mitresB = computeGutterMitres(assemblyB.gutter, assemblyB.segment, [
        { gutter: assemblyA.gutter, segment: assemblyA.segment },
      ])
      const gutterA = gutterWorldGeometry(wallA, leanToA, assemblyA, mitresA)
      const gutterB = gutterWorldGeometry(wallB, leanToB, assemblyB, mitresB)
      const distance = Math.min(
        closestMeshDistance(gutterA, gutterB),
        closestMeshDistance(gutterB, gutterA),
      )
      const contactsA = contactingVertices(gutterA, gutterB)
      const contactsB = contactingVertices(gutterB, gutterA)

      expect(distance).toBeLessThan(1e-4)
      expect(contactsA.length).toBeGreaterThan(10)
      expect(contactsB.length).toBeGreaterThan(10)
      gutterA.dispose()
      gutterB.dispose()
    }
  })
})
