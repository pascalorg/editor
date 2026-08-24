import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  getRoofSegmentSurfaceY,
  getWallCurveLength,
  LeanToExtensionNode,
  WallNode,
} from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import * as THREE from 'three'
import { computeGutterMitres, type GutterMitres } from '../gutter/corner-mitre'
import { buildGutterGeometry } from '../gutter/geometry'
import { bendLocalPoint } from './arc'
import { createLeanToAssembly, leanToCornerPostIndex, managedLeanToPostIndex } from './assembly'
import { resolveLeanToCornerJoints } from './corner-joint'
import { leanToWallLocalPose, resolveLeanToWallPlacement } from './layout'
import { applyLeanToWallAutoSpan, applyLeanToWallCornerSpan } from './roof-attachment'

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

function innerCornerFixture(interiorAngleDegrees = 90) {
  const corner: [number, number] = [4, 0]
  const radians = (interiorAngleDegrees * Math.PI) / 180
  const wallA = WallNode.parse({
    id: 'wall_inner_corner_a',
    parentId: 'level_inner_corner',
    start: [0, 0],
    end: corner,
  })
  const wallB = WallNode.parse({
    id: 'wall_inner_corner_b',
    parentId: 'level_inner_corner',
    start: corner,
    end: [corner[0] + 4 * Math.cos(radians), 4 * Math.sin(radians)],
  })
  const leanToA = LeanToExtensionNode.parse({
    id: 'leanto_inner_corner_a',
    parentId: wallA.id,
    position: [2, 0, 0.05],
    span: 4,
  })
  const leanToB = LeanToExtensionNode.parse({
    id: 'leanto_inner_corner_b',
    parentId: wallB.id,
    position: [2, 0, 0.05],
    span: 4,
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
  const pose = leanToWallLocalPose(wall, leanTo, 0)
  return new THREE.Matrix4()
    .makeTranslation(...pose.position)
    .multiply(new THREE.Matrix4().makeRotationY(pose.rotationY))
    .multiply(new THREE.Matrix4().makeTranslation(...segment.position))
    .multiply(new THREE.Matrix4().makeRotationY(segment.rotation))
}

function cornerPlanPointToWorld(
  wall: ReturnType<typeof WallNode.parse>,
  leanTo: ReturnType<typeof LeanToExtensionNode.parse>,
  point: readonly [number, number],
) {
  const pose = leanToWallLocalPose(wall, leanTo, 0)
  const bent = bendLocalPoint(leanTo, point[0], point[1])
  return new THREE.Vector3(bent.x, 0, bent.y).applyMatrix4(
    new THREE.Matrix4()
      .makeTranslation(...pose.position)
      .multiply(new THREE.Matrix4().makeRotationY(pose.rotationY)),
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
      const distance = point.distanceTo(closest)
      if (Number.isFinite(distance)) minimum = Math.min(minimum, distance)
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
      const distance = point.distanceTo(closest)
      if (Number.isFinite(distance)) minimum = Math.min(minimum, distance)
    }
    if (minimum < 1e-4) contacts.push(point.toArray())
  }
  return contacts
}

function boundaryVerticesNear(
  geometry: THREE.BufferGeometry,
  center: THREE.Vector3,
  radius: number,
): THREE.Vector3[] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position')
  const precision = 1e5
  const pointKey = (index: number) =>
    [position.getX(index), position.getY(index), position.getZ(index)]
      .map((value) => Math.round(value * precision))
      .join(':')
  const points = new Map<string, THREE.Vector3>()
  const edges = new Map<string, number>()
  for (let offset = 0; offset < position.count; offset += 3) {
    for (const [a, b] of [
      [offset, offset + 1],
      [offset + 1, offset + 2],
      [offset + 2, offset],
    ] as const) {
      const aKey = pointKey(a)
      const bKey = pointKey(b)
      points.set(aKey, new THREE.Vector3().fromBufferAttribute(position, a))
      points.set(bKey, new THREE.Vector3().fromBufferAttribute(position, b))
      const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
      edges.set(edgeKey, (edges.get(edgeKey) ?? 0) + 1)
    }
  }
  const boundaryKeys = new Set<string>()
  for (const [edge, count] of edges) {
    if (count !== 1) continue
    const [a, b] = edge.split('|')
    boundaryKeys.add(a!)
    boundaryKeys.add(b!)
  }
  if (source !== geometry) source.dispose()
  return [...boundaryKeys]
    .map((key) => points.get(key)!)
    .filter((point) => Math.hypot(point.x - center.x, point.z - center.z) < radius)
}

describe('lean-to corner joint', () => {
  test('partitions an inner L into one valley with connected gutters, beam, and post', () => {
    const { wallA, wallB, leanToA, leanToB, nodes } = innerCornerFixture()
    const jointA = resolveLeanToCornerJoints(leanToA, wallA, nodes).right
    const jointB = resolveLeanToCornerJoints(leanToB, wallB, nodes).left

    expect(jointA?.neighborId).toBe(leanToB.id)
    expect(jointB?.neighborId).toBe(leanToA.id)
    expect(jointA!.roofExtension).toBeLessThan(0)
    expect(jointB?.roofExtension).toBeCloseTo(jointA!.roofExtension, 6)
    expect(jointA!.beamExtension).toBeLessThan(0)
    expect(jointB?.beamExtension).toBeCloseTo(jointA!.beamExtension, 6)
    expect(jointA?.gutterMitre).toBeCloseTo(-Math.PI / 4, 8)
    expect(jointB?.gutterMitre).toBeCloseTo(-Math.PI / 4, 8)

    const seamA = jointA?.seam?.map((point) => cornerPlanPointToWorld(wallA, leanToA, point))
    const seamB = jointB?.seam?.map((point) => cornerPlanPointToWorld(wallB, leanToB, point))
    expect(seamA).toHaveLength(2)
    expect(seamB).toHaveLength(2)
    expect(pointSetHausdorffDistance(seamA!, seamB!)).toBeLessThan(1e-5)

    const assemblyA = createLeanToAssembly(leanToA, undefined, nodes)
    const assemblyB = createLeanToAssembly(leanToB, undefined, nodes)
    expect(assemblyA.segment.shedFootprintPieces).toHaveLength(1)
    expect(assemblyB.segment.shedFootprintPieces).toHaveLength(1)
    const roofMeshes = [
      new THREE.Mesh(
        generateRoofSegmentGeometry(assemblyA.segment).applyMatrix4(
          segmentWorldMatrix(wallA, leanToA, assemblyA.segment),
        ),
      ),
      new THREE.Mesh(
        generateRoofSegmentGeometry(assemblyB.segment).applyMatrix4(
          segmentWorldMatrix(wallB, leanToB, assemblyB.segment),
        ),
      ),
    ]
    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    const invalidCoverage: [number, number, number][] = []
    for (let x = 1.4; x < 3.9; x += 0.15) {
      for (let z = 0.15; z < 2.7; z += 0.15) {
        raycaster.ray.origin.set(x, 10, z)
        const owners = roofMeshes.filter(
          (mesh) => raycaster.intersectObject(mesh, false).length > 0,
        ).length
        if (owners !== 1) invalidCoverage.push([x, z, owners])
      }
    }
    expect(invalidCoverage).toEqual([])
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
    expect(assemblyA.posts.some((post) => managedLeanToPostIndex(post) === 2)).toBe(false)
    expect(assemblyB.posts.some((post) => managedLeanToPostIndex(post) === 0)).toBe(false)
    const regularPostsA = assemblyA.posts.filter(
      (post) => (managedLeanToPostIndex(post) ?? -1) >= 0,
    )
    const regularPostsB = assemblyB.posts.filter(
      (post) => (managedLeanToPostIndex(post) ?? -1) >= 0,
    )
    expect(
      regularPostsA.every((post) => post.position[0] < jointA!.sharedPostPosition[0] - 1e-6),
    ).toBe(true)
    expect(
      regularPostsB.every((post) => post.position[0] > jointB!.sharedPostPosition[0] + 1e-6),
    ).toBe(true)
    for (const mesh of roofMeshes) mesh.geometry.dispose()
    gutterA.dispose()
    gutterB.dispose()
  })

  test('resolves inward V corners continuously across the supported angle range', () => {
    for (const angle of continuousSupportedAngles) {
      const { wallA, wallB, leanToA, leanToB, nodes } = innerCornerFixture(angle)
      const jointA = resolveLeanToCornerJoints(leanToA, wallA, nodes).right
      const jointB = resolveLeanToCornerJoints(leanToB, wallB, nodes).left
      const expectedMitre = -(angle * Math.PI) / 360

      expect(jointA?.kind).toBe('concave')
      expect(jointB?.kind).toBe('concave')
      expect(jointA?.gutterMitre).toBeCloseTo(expectedMitre, 8)
      expect(jointB?.gutterMitre).toBeCloseTo(expectedMitre, 8)
      expect(jointA!.roofExtension).toBeLessThan(0)
      expect(jointB!.roofExtension).toBeLessThan(0)
      expect(jointA!.beamExtension).toBeLessThan(0)
      expect(jointB!.beamExtension).toBeLessThan(0)
      const seamA = jointA?.seam?.map((point) => cornerPlanPointToWorld(wallA, leanToA, point))
      const seamB = jointB?.seam?.map((point) => cornerPlanPointToWorld(wallB, leanToB, point))
      expect(seamA).toHaveLength(2)
      expect(seamB).toHaveLength(2)
      expect(pointSetHausdorffDistance(seamA!, seamB!)).toBeLessThan(1e-5)
    }
  })

  test('gives unequal inner roofs one coincident valley seam', () => {
    const fixture = innerCornerFixture()
    const leanToB = LeanToExtensionNode.parse({
      ...fixture.leanToB,
      highEdgeHeight: 3.1,
      pitch: 16,
    })
    const nodes = { ...fixture.nodes, [leanToB.id]: leanToB }
    const jointA = resolveLeanToCornerJoints(fixture.leanToA, fixture.wallA, nodes).right
    const jointB = resolveLeanToCornerJoints(leanToB, fixture.wallB, nodes).left
    const seamA = jointA?.seam?.map((point) =>
      cornerPlanPointToWorld(fixture.wallA, fixture.leanToA, point),
    )
    const seamB = jointB?.seam?.map((point) =>
      cornerPlanPointToWorld(fixture.wallB, leanToB, point),
    )

    expect(seamA).toHaveLength(2)
    expect(seamB).toHaveLength(2)
    expect(pointSetHausdorffDistance(seamA!, seamB!)).toBeLessThan(1e-5)
  })

  test('extends both roofs to one curved-to-straight low corner', () => {
    const curvedWall = WallNode.parse({
      id: 'wall_curved_miter',
      parentId: 'level_curved_miter',
      start: [0, 0],
      end: [6, 0],
      curveOffset: -0.5,
    })
    const straightWall = WallNode.parse({
      id: 'wall_straight_miter',
      parentId: 'level_curved_miter',
      start: [6, 0],
      end: [6, -6],
    })
    const curved = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(curvedWall, getWallCurveLength(curvedWall) / 2, 'front')!,
        curvedWall,
      ),
      id: 'leanto_curved_miter',
    }
    const straight = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(straightWall, 3, 'front')!,
        straightWall,
      ),
      id: 'leanto_straight_miter',
    }
    const nodes = Object.fromEntries(
      [curvedWall, straightWall, curved, straight].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const joint = resolveLeanToCornerJoints(straight, straightWall, nodes).left
    const reciprocal = resolveLeanToCornerJoints(curved, curvedWall, nodes).right
    const straightSeam = joint?.seam?.map((point) =>
      cornerPlanPointToWorld(straightWall, straight, point),
    )
    const curvedSeam = reciprocal?.seam?.map((point) =>
      cornerPlanPointToWorld(curvedWall, curved, point),
    )

    expect(joint?.roofExtension).toBeCloseTo(1.811, 2)
    expect(joint?.gutterMitre).toBeCloseTo(0.577309, 5)
    expect(joint?.roofPiece).toHaveLength(3)
    expect(reciprocal?.roofPiece).toHaveLength(3)
    expect(straightSeam).toHaveLength(2)
    expect(curvedSeam).toHaveLength(2)
    expect(pointSetHausdorffDistance(straightSeam!, curvedSeam!)).toBeLessThan(1e-5)

    const straightAssembly = createLeanToAssembly(straight, undefined, nodes)
    const straightGeometry = generateRoofSegmentGeometry(straightAssembly.segment).applyMatrix4(
      segmentWorldMatrix(straightWall, straight, straightAssembly.segment),
    )
    straightGeometry.dispose()

    const curvedAssembly = createLeanToAssembly(curved, undefined, nodes)
    const curvedGeometry = generateRoofSegmentGeometry(curvedAssembly.segment).applyMatrix4(
      segmentWorldMatrix(curvedWall, curved, curvedAssembly.segment),
    )
    expect(
      new THREE.Box3().setFromBufferAttribute(curvedGeometry.getAttribute('position')).max.x,
    ).toBeLessThan(8.81)
    curvedGeometry.dispose()
  })

  test('auto-connects a shallow slanted shed to a curved shed using the gutter chord angle', () => {
    const curvedWall = WallNode.parse({
      id: 'wall_curved_shallow_corner',
      parentId: 'level_curved_shallow_corner',
      start: [0, 0],
      end: [6, 0],
      curveOffset: -0.5,
    })
    const straightWall = WallNode.parse({
      id: 'wall_straight_shallow_corner',
      parentId: 'level_curved_shallow_corner',
      start: [6, 0],
      end: [6 + 6 / Math.sqrt(2), -6 / Math.sqrt(2)],
    })
    const curved = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(curvedWall, getWallCurveLength(curvedWall) / 2, 'front')!,
        curvedWall,
      ),
      id: 'leanto_curved_shallow_corner',
    }
    const straight = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(straightWall, 3, 'front')!,
        straightWall,
      ),
      id: 'leanto_straight_shallow_corner',
    }
    const nodes = Object.fromEntries(
      [curvedWall, straightWall, curved, straight].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const curvedJoint = resolveLeanToCornerJoints(curved, curvedWall, nodes).right
    const straightJoint = resolveLeanToCornerJoints(straight, straightWall, nodes).left
    const curvedSeam = curvedJoint?.seam?.map((point) =>
      cornerPlanPointToWorld(curvedWall, curved, point),
    )
    const straightSeam = straightJoint?.seam?.map((point) =>
      cornerPlanPointToWorld(straightWall, straight, point),
    )

    expect(curvedJoint?.neighborId).toBe(straight.id)
    expect(straightJoint?.neighborId).toBe(curved.id)
    expect(curvedJoint?.gutterMitre).toBeCloseTo(0.213267, 5)
    expect(straightJoint?.gutterMitre).toBeCloseTo(0.213267, 5)
    expect(curvedSeam).toHaveLength(2)
    expect(straightSeam).toHaveLength(2)
    expect(pointSetHausdorffDistance(curvedSeam!, straightSeam!)).toBeLessThan(1e-5)
    expect(curvedJoint?.roofPiece).toHaveLength(3)
    expect(straightJoint?.roofPiece).toHaveLength(3)

    const curvedAssembly = createLeanToAssembly(curved, undefined, nodes)
    const straightAssembly = createLeanToAssembly(straight, undefined, nodes)
    const curvedGeometry = generateRoofSegmentGeometry(curvedAssembly.segment).applyMatrix4(
      segmentWorldMatrix(curvedWall, curved, curvedAssembly.segment),
    )
    const straightGeometry = generateRoofSegmentGeometry(straightAssembly.segment).applyMatrix4(
      segmentWorldMatrix(straightWall, straight, straightAssembly.segment),
    )
    const roofMeshes = [new THREE.Mesh(curvedGeometry), new THREE.Mesh(straightGeometry)]
    const expectedMeshes = [
      new THREE.Mesh(
        generateRoofSegmentGeometry({
          ...curvedAssembly.segment,
          shedFootprintPieces: [],
        }).applyMatrix4(segmentWorldMatrix(curvedWall, curved, curvedAssembly.segment)),
      ),
      new THREE.Mesh(
        generateRoofSegmentGeometry({
          ...straightAssembly.segment,
          shedFootprintPieces: [],
        }).applyMatrix4(segmentWorldMatrix(straightWall, straight, straightAssembly.segment)),
      ),
    ]
    const bounds = new THREE.Box3().setFromObject(expectedMeshes[0]!)
    bounds.union(new THREE.Box3().setFromObject(expectedMeshes[1]!))
    const raycaster = new THREE.Raycaster()
    raycaster.ray.direction.set(0, -1, 0)
    const uncovered: [number, number][] = []
    const overlaps: [number, number][] = []
    for (let x = bounds.min.x + 0.027; x < bounds.max.x; x += 0.05) {
      for (let z = bounds.min.z + 0.033; z < bounds.max.z; z += 0.05) {
        if (x < 5.8 || z > 2) continue
        raycaster.ray.origin.set(x, 10, z)
        const expected = expectedMeshes.some(
          (mesh) => raycaster.intersectObject(mesh, false).length > 0,
        )
        if (!expected) continue
        const owners = roofMeshes.filter(
          (mesh) => raycaster.intersectObject(mesh, false).length > 0,
        ).length
        if (owners === 0) uncovered.push([x, z])
        if (owners > 1) overlaps.push([x, z])
      }
    }
    const curvedToStraightDistance = closestMeshDistance(curvedGeometry, straightGeometry)
    const straightToCurvedDistance = closestMeshDistance(straightGeometry, curvedGeometry)
    expect(Math.min(curvedToStraightDistance, straightToCurvedDistance)).toBeLessThan(0.02)
    expect(contactingVertices(curvedGeometry, straightGeometry).length).toBeGreaterThan(2)
    expect(contactingVertices(straightGeometry, curvedGeometry).length).toBeGreaterThan(2)
    expect(uncovered).toEqual([])
    expect(overlaps).toEqual([])
    const curvedGutter = gutterWorldGeometry(
      curvedWall,
      curved,
      curvedAssembly,
      computeGutterMitres(curvedAssembly.gutter, curvedAssembly.segment, [
        { gutter: straightAssembly.gutter, segment: straightAssembly.segment },
      ]),
    )
    const straightGutter = gutterWorldGeometry(
      straightWall,
      straight,
      straightAssembly,
      computeGutterMitres(straightAssembly.gutter, straightAssembly.segment, [
        { gutter: curvedAssembly.gutter, segment: curvedAssembly.segment },
      ]),
    )
    const curvedContacts = contactingVertices(curvedGutter, straightGutter)
    const straightContacts = contactingVertices(straightGutter, curvedGutter)
    const lowRoofCorner = curvedSeam![1]!
    const roofToGutterCorner = Math.min(
      ...[...curvedContacts, ...straightContacts].map((point) =>
        Math.hypot(point[0]! - lowRoofCorner.x, point[2]! - lowRoofCorner.z),
      ),
    )
    expect(curvedContacts.length).toBeGreaterThan(10)
    expect(straightContacts.length).toBeGreaterThan(10)
    expect(roofToGutterCorner).toBeLessThan(0.05)
    const curvedEndProfile = boundaryVerticesNear(curvedGutter, lowRoofCorner, 0.3)
    const straightEndProfile = boundaryVerticesNear(straightGutter, lowRoofCorner, 0.3)
    expect(curvedEndProfile.length).toBeGreaterThan(10)
    expect(straightEndProfile.length).toBeGreaterThan(10)
    expect(pointSetHausdorffDistance(curvedEndProfile, straightEndProfile)).toBeLessThan(0.002)
    curvedGeometry.dispose()
    straightGeometry.dispose()
    curvedGutter.dispose()
    straightGutter.dispose()
    for (const mesh of expectedMeshes) mesh.geometry.dispose()
  })

  test('connects three consecutive curved-straight-curved canopies through both ends', () => {
    const wallA = WallNode.parse({
      id: 'wall_chain_curved_a',
      parentId: 'level_chain',
      start: [0, 0],
      end: [6, 0],
      curveOffset: -0.5,
    })
    const wallB = WallNode.parse({
      id: 'wall_chain_straight',
      parentId: 'level_chain',
      start: [6, 0],
      end: [6, -6],
    })
    const wallC = WallNode.parse({
      id: 'wall_chain_curved_c',
      parentId: 'level_chain',
      start: [6, -6],
      end: [12, -6],
      curveOffset: -0.5,
    })
    const leanToA = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(wallA, getWallCurveLength(wallA) / 2, 'front')!,
        wallA,
      ),
      id: 'leanto_chain_curved_a',
    }
    const overlongLeanToB = {
      ...applyLeanToWallAutoSpan(resolveLeanToWallPlacement(wallB, 3, 'front')!, wallB),
      id: 'leanto_chain_straight',
      autoSpan: false,
      span: 7,
      highEdgeHeight: 3.1,
      pitch: 16,
    }
    const leanToB = applyLeanToWallCornerSpan(overlongLeanToB, wallB)
    const leanToC = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(wallC, getWallCurveLength(wallC) / 2, 'front')!,
        wallC,
      ),
      id: 'leanto_chain_curved_c',
    }
    const nodes = Object.fromEntries(
      [wallA, wallB, wallC, leanToA, leanToB, leanToC].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    expect(leanToB.span).toBeCloseTo(5.7, 8)
    expect(leanToB.position[0]).toBeCloseTo(3, 8)

    const jointsB = resolveLeanToCornerJoints(leanToB, wallB, nodes)
    const jointsC = resolveLeanToCornerJoints(leanToC, wallC, nodes)
    const seamAB = jointsB.left?.seam?.map((point) => cornerPlanPointToWorld(wallB, leanToB, point))
    const seamBC = jointsB.right?.seam?.map((point) =>
      cornerPlanPointToWorld(wallB, leanToB, point),
    )
    const reciprocalSeamBC = jointsC.left?.seam?.map((point) =>
      cornerPlanPointToWorld(wallC, leanToC, point),
    )

    expect(jointsB.left?.neighborId).toBe(leanToA.id)
    expect(jointsB.right?.neighborId).toBe(leanToC.id)
    expect(jointsC.left?.neighborId).toBe(leanToB.id)
    expect(seamAB).toHaveLength(2)
    expect(seamBC).toHaveLength(2)
    expect(reciprocalSeamBC).toHaveLength(2)
    expect(pointSetHausdorffDistance(seamBC!, reciprocalSeamBC!)).toBeLessThan(1e-5)
    expect(jointsB.left?.roofPiece.length).toBeGreaterThanOrEqual(3)
    expect(jointsB.right?.roofPiece.length).toBeGreaterThanOrEqual(3)

    const assemblyB = createLeanToAssembly(leanToB, undefined, nodes)
    const assemblyC = createLeanToAssembly(leanToC, undefined, nodes)
    const geometryB = generateRoofSegmentGeometry(assemblyB.segment).applyMatrix4(
      segmentWorldMatrix(wallB, leanToB, assemblyB.segment),
    )
    const geometryC = generateRoofSegmentGeometry(assemblyC.segment).applyMatrix4(
      segmentWorldMatrix(wallC, leanToC, assemblyC.segment),
    )
    expect(closestMeshDistance(geometryB, geometryC)).toBeLessThan(0.06)
    expect(jointsB.right?.roofExtension).toBe(0)
    expect(jointsC.left?.roofExtension).toBe(0)
    expect(jointsB.right?.gutterMitre).toBeCloseTo(jointsC.left?.gutterMitre ?? 0, 8)
    geometryB.dispose()
    geometryC.dispose()
  })

  test('keeps both joins of a fully inward curved middle canopy connected', () => {
    const wallA = WallNode.parse({
      id: 'wall_inward_chain_left',
      parentId: 'level_inward_chain',
      start: [-4, -4],
      end: [0, 0],
    })
    const wallB = WallNode.parse({
      id: 'wall_inward_chain_center',
      parentId: 'level_inward_chain',
      start: [0, 0],
      end: [6, 0],
      curveOffset: -3,
    })
    const wallC = WallNode.parse({
      id: 'wall_inward_chain_right',
      parentId: 'level_inward_chain',
      start: [6, 0],
      end: [10, -4],
    })
    const leanToA = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(wallA, getWallCurveLength(wallA) / 2, 'front')!,
        wallA,
      ),
      id: 'leanto_inward_chain_left',
    }
    const leanToB = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(wallB, getWallCurveLength(wallB) / 2, 'front')!,
        wallB,
      ),
      id: 'leanto_inward_chain_center',
    }
    const leanToC = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(wallC, getWallCurveLength(wallC) / 2, 'front')!,
        wallC,
      ),
      id: 'leanto_inward_chain_right',
    }
    const nodes = Object.fromEntries(
      [wallA, wallB, wallC, leanToA, leanToB, leanToC].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const jointsA = resolveLeanToCornerJoints(leanToA, wallA, nodes)
    const jointsB = resolveLeanToCornerJoints(leanToB, wallB, nodes)
    const jointsC = resolveLeanToCornerJoints(leanToC, wallC, nodes)

    expect(jointsB.left?.neighborId).toBe(leanToA.id)
    expect(jointsB.right?.neighborId).toBe(leanToC.id)
    expect(jointsB.left?.roofPiece.length).toBeGreaterThanOrEqual(3)
    expect(jointsB.right?.roofPiece.length).toBeGreaterThanOrEqual(3)

    for (const [own, reciprocal, ownWall, ownLeanTo, reciprocalWall, reciprocalLeanTo] of [
      [jointsB.left, jointsA.right, wallB, leanToB, wallA, leanToA],
      [jointsB.right, jointsC.left, wallB, leanToB, wallC, leanToC],
    ] as const) {
      const ownSeam = own?.seam?.map((point) =>
        cornerPlanPointToWorld(ownWall, ownLeanTo, point),
      )
      const reciprocalSeam = reciprocal?.seam?.map((point) =>
        cornerPlanPointToWorld(reciprocalWall, reciprocalLeanTo, point),
      )
      expect(ownSeam).toHaveLength(2)
      expect(reciprocalSeam).toHaveLength(2)
      expect(pointSetHausdorffDistance(ownSeam!, reciprocalSeam!)).toBeLessThan(1e-5)
    }

    const centerAssembly = createLeanToAssembly(leanToB, undefined, nodes)
    expect(centerAssembly.segment.shedFootprintPieces).toHaveLength(1)
    expect(centerAssembly.segment.shedFootprintPieces?.[0]).toHaveLength(5)
  })

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
    // The full-angle sweep runs ~6s on CI's 2-core x64 runners — over bun's
    // default 5s per-test budget (2-3s locally on Apple Silicon).
  }, 30_000)

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
