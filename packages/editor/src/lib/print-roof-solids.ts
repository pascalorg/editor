import {
  type AnyNode,
  getRoofModuleFaces,
  getRoofShapeInsets,
  getRoofShapeRatios,
  getSegmentSlopeFrame,
  nodeRegistry,
  normalizeRoofSegmentTrim,
  type RoofSegmentNode,
  type RoofShapeFaceVertex,
} from '@pascal-app/core'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Manufacturing geometry belongs to the editor layer, not the read-only viewer runtime.
const FACE_EPSILON = 1e-7
const SURFACE_NORMAL_EPSILON = 1e-6

type RoofFace = RoofShapeFaceVertex[]

export type PrintRoofSolidDiagnostic = {
  severity: 'error'
  code:
    | 'invalid_roof_print_dimensions'
    | 'roof_print_topology_mismatch'
    | 'unsupported_roof_print_trim'
    | 'unsupported_roof_print_cut'
  message: string
  nodeIds: string[]
}

export type PrintRoofSolidResult =
  | { status: 'ready'; object: THREE.Group; diagnostics: [] }
  | { status: 'blocked'; object: null; diagnostics: PrintRoofSolidDiagnostic[] }

type BoundaryEdge = {
  start: RoofShapeFaceVertex
  end: RoofShapeFaceVertex
}

type RoofModuleGeometryResult =
  | { status: 'ready'; geometry: THREE.BufferGeometry }
  | { status: 'blocked'; message: string }

function faceNormal(face: RoofFace): THREE.Vector3 | null {
  if (face.length < 3) return null
  const origin = new THREE.Vector3(face[0]!.x, face[0]!.y, face[0]!.z)
  const first = new THREE.Vector3()
  const second = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (let firstIndex = 1; firstIndex < face.length - 1; firstIndex += 1) {
    first.set(face[firstIndex]!.x, face[firstIndex]!.y, face[firstIndex]!.z).sub(origin)
    for (let secondIndex = firstIndex + 1; secondIndex < face.length; secondIndex += 1) {
      second.set(face[secondIndex]!.x, face[secondIndex]!.y, face[secondIndex]!.z).sub(origin)
      normal.crossVectors(first, second)
      if (normal.lengthSq() > FACE_EPSILON * FACE_EPSILON) return normal.normalize()
    }
  }

  return null
}

function pointKey(point: RoofShapeFaceVertex): string {
  return `${Math.round(point.x / FACE_EPSILON)},${Math.round(
    point.y / FACE_EPSILON,
  )},${Math.round(point.z / FACE_EPSILON)}`
}

function edgeKey(a: RoofShapeFaceVertex, b: RoofShapeFaceVertex): string {
  const keyA = pointKey(a)
  const keyB = pointKey(b)
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`
}

function projectFace(face: RoofFace, normal: THREE.Vector3): THREE.Vector2[] {
  const absX = Math.abs(normal.x)
  const absY = Math.abs(normal.y)
  const absZ = Math.abs(normal.z)

  if (absX >= absY && absX >= absZ) {
    return face.map((point) => new THREE.Vector2(point.z, point.y))
  }
  if (absY >= absX && absY >= absZ) {
    return face.map((point) => new THREE.Vector2(point.x, point.z))
  }
  return face.map((point) => new THREE.Vector2(point.x, point.y))
}

function geometryFromFaces(faces: RoofFace[]): THREE.BufferGeometry | null {
  const positions: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const triangleSecondEdge = new THREE.Vector3()
  const triangleNormal = new THREE.Vector3()

  for (const face of faces) {
    const normal = faceNormal(face)
    if (!normal) return null
    const triangles = THREE.ShapeUtils.triangulateShape(projectFace(face, normal), [])
    if (triangles.length === 0) return null

    for (const triangle of triangles) {
      const [indexA, indexB, indexC] = triangle
      if (indexA === undefined || indexB === undefined || indexC === undefined) return null
      const pointA = face[indexA]!
      let pointB = face[indexB]!
      let pointC = face[indexC]!
      a.set(pointA.x, pointA.y, pointA.z)
      b.set(pointB.x, pointB.y, pointB.z)
      c.set(pointC.x, pointC.y, pointC.z)
      triangleNormal.subVectors(b, a).cross(triangleSecondEdge.subVectors(c, a))
      if (triangleNormal.dot(normal) < 0) {
        ;[pointB, pointC] = [pointC, pointB]
      }
      positions.push(
        pointA.x,
        pointA.y,
        pointA.z,
        pointB.x,
        pointB.y,
        pointB.z,
        pointC.x,
        pointC.y,
        pointC.z,
      )
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const indexed = mergeVertices(geometry, FACE_EPSILON)
  geometry.dispose()
  indexed.computeVertexNormals()
  return indexed
}

function selectSurfaceFaces(
  faces: RoofFace[],
  include: (normal: THREE.Vector3) => boolean,
  reverse = false,
): RoofFace[] | null {
  const selected: RoofFace[] = []
  for (const face of faces) {
    const normal = faceNormal(face)
    if (!normal) return null
    if (include(normal)) selected.push(reverse ? [...face].reverse() : face)
  }
  return selected.length > 0 ? selected : null
}

function boundaryEdges(faces: RoofFace[]): BoundaryEdge[] | null {
  const edgeUses = new Map<string, BoundaryEdge[]>()
  for (const face of faces) {
    for (let edgeIndex = 0; edgeIndex < face.length; edgeIndex += 1) {
      const nextIndex = (edgeIndex + 1) % face.length
      const edge = { start: face[edgeIndex]!, end: face[nextIndex]! }
      const key = edgeKey(edge.start, edge.end)
      const uses = edgeUses.get(key) ?? []
      uses.push(edge)
      edgeUses.set(key, uses)
    }
  }

  const boundary: BoundaryEdge[] = []
  for (const uses of edgeUses.values()) {
    if (uses.length === 1) boundary.push(uses[0]!)
    else if (uses.length !== 2) return null
  }
  return boundary
}

function pointDistanceSq(a: RoofShapeFaceVertex, b: RoofShapeFaceVertex): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function boundaryLoops(edges: BoundaryEdge[]): RoofFace[] | null {
  const byStart = new Map<string, BoundaryEdge>()
  for (const edge of edges) {
    const key = pointKey(edge.start)
    if (byStart.has(key)) return null
    byStart.set(key, edge)
  }

  const unused = new Set(byStart.keys())
  const loops: RoofFace[] = []
  while (unused.size > 0) {
    const firstKey = unused.values().next().value
    if (typeof firstKey !== 'string') return null
    const loop: RoofFace = []
    let key = firstKey

    do {
      const edge = byStart.get(key)
      if (!edge || !unused.delete(key)) return null
      loop.push(edge.start)
      key = pointKey(edge.end)
    } while (key !== firstKey)

    if (loop.length < 3) return null
    loops.push(loop)
  }

  return loops
}

function loopCentroid(loop: RoofFace): RoofShapeFaceVertex {
  const sum = loop.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y, z: total.z + point.z }),
    { x: 0, y: 0, z: 0 },
  )
  return { x: sum.x / loop.length, y: sum.y / loop.length, z: sum.z / loop.length }
}

function rotated<T>(values: T[], start: number): T[] {
  return [...values.slice(start), ...values.slice(0, start)]
}

function bridgeBoundaryLoop(first: RoofFace, second: RoofFace): RoofFace[] | null {
  const reversedSecond = [...second].reverse()
  let best: { cost: number; second: RoofFace; moves: ('first' | 'second')[] } | undefined

  for (let secondStart = 0; secondStart < reversedSecond.length; secondStart += 1) {
    const candidate = rotated(reversedSecond, secondStart)
    const width = candidate.length + 1
    const costs = new Array<number>((first.length + 1) * width).fill(Number.POSITIVE_INFINITY)
    const previous = new Array<'first' | 'second' | undefined>(costs.length)
    const indexOf = (firstIndex: number, secondIndex: number) => firstIndex * width + secondIndex
    costs[0] = pointDistanceSq(first[0]!, candidate[0]!)

    for (let firstIndex = 0; firstIndex <= first.length; firstIndex += 1) {
      for (let secondIndex = 0; secondIndex <= candidate.length; secondIndex += 1) {
        const index = indexOf(firstIndex, secondIndex)
        const cost = costs[index]!
        if (!Number.isFinite(cost)) continue
        const firstPoint = first[firstIndex % first.length]!
        const secondPoint = candidate[secondIndex % candidate.length]!

        if (firstIndex < first.length) {
          const nextFirst = first[(firstIndex + 1) % first.length]!
          const nextIndex = indexOf(firstIndex + 1, secondIndex)
          const nextCost = cost + pointDistanceSq(nextFirst, secondPoint)
          if (nextCost < costs[nextIndex]!) {
            costs[nextIndex] = nextCost
            previous[nextIndex] = 'first'
          }
        }
        if (secondIndex < candidate.length) {
          const nextSecond = candidate[(secondIndex + 1) % candidate.length]!
          const nextIndex = indexOf(firstIndex, secondIndex + 1)
          const nextCost = cost + pointDistanceSq(firstPoint, nextSecond)
          if (nextCost < costs[nextIndex]!) {
            costs[nextIndex] = nextCost
            previous[nextIndex] = 'second'
          }
        }
      }
    }

    const endIndex = indexOf(first.length, candidate.length)
    const moves: ('first' | 'second')[] = []
    let firstIndex = first.length
    let secondIndex = candidate.length
    while (firstIndex > 0 || secondIndex > 0) {
      const move = previous[indexOf(firstIndex, secondIndex)]
      if (!move) return null
      moves.push(move)
      if (move === 'first') firstIndex -= 1
      else secondIndex -= 1
    }
    moves.reverse()

    if (!best || costs[endIndex]! < best.cost) {
      best = { cost: costs[endIndex]!, second: candidate, moves }
    }
  }

  if (!best) return null
  const bridges: RoofFace[] = []
  let firstIndex = 0
  let secondIndex = 0
  for (const move of best.moves) {
    const firstPoint = first[firstIndex % first.length]!
    const secondPoint = best.second[secondIndex % best.second.length]!
    if (move === 'first') {
      const nextFirst = first[(firstIndex + 1) % first.length]!
      bridges.push([nextFirst, firstPoint, secondPoint])
      firstIndex += 1
    } else {
      const nextSecond = best.second[(secondIndex + 1) % best.second.length]!
      bridges.push([firstPoint, secondPoint, nextSecond])
      secondIndex += 1
    }
  }
  return bridges
}

function bridgeBoundaries(first: BoundaryEdge[], second: BoundaryEdge[]): RoofFace[] | null {
  const firstLoops = boundaryLoops(first)
  const secondLoops = boundaryLoops(second)
  if (!firstLoops || !secondLoops || firstLoops.length !== secondLoops.length) return null

  const unmatched = new Set(secondLoops.map((_, index) => index))
  const bridges: RoofFace[] = []
  for (const firstLoop of firstLoops) {
    const firstCentroid = loopCentroid(firstLoop)
    let bestIndex = -1
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidateIndex of unmatched) {
      const score = pointDistanceSq(firstCentroid, loopCentroid(secondLoops[candidateIndex]!))
      if (score < bestScore) {
        bestIndex = candidateIndex
        bestScore = score
      }
    }
    if (bestIndex < 0) return null
    unmatched.delete(bestIndex)
    const loopBridges = bridgeBoundaryLoop(firstLoop, secondLoops[bestIndex]!)
    if (!loopBridges) return null
    bridges.push(...loopBridges)
  }
  return bridges
}

function splitWallBoundary(edges: BoundaryEdge[]): {
  bottom: BoundaryEdge[]
  top: BoundaryEdge[]
} | null {
  const bottom: BoundaryEdge[] = []
  const top: BoundaryEdge[] = []
  for (const edge of edges) {
    if (Math.abs(edge.start.y) <= FACE_EPSILON && Math.abs(edge.end.y) <= FACE_EPSILON) {
      bottom.push(edge)
    } else {
      top.push(edge)
    }
  }
  return bottom.length > 0 && top.length > 0 ? { bottom, top } : null
}

function buildRoofModuleGeometry(
  wallOuterFaces: RoofFace[],
  wallInnerFaces: RoofFace[],
  roofOuterFaces: RoofFace[],
  roofInnerFaces: RoofFace[],
): RoofModuleGeometryResult {
  const isWall = (normal: THREE.Vector3) => Math.abs(normal.y) <= SURFACE_NORMAL_EPSILON
  const isRoof = (normal: THREE.Vector3) => normal.y > SURFACE_NORMAL_EPSILON
  const wallOuter = selectSurfaceFaces(wallOuterFaces, isWall)
  const wallInner = selectSurfaceFaces(wallInnerFaces, isWall, true)
  const roofOuter = selectSurfaceFaces(roofOuterFaces, isRoof)
  const roofInner = selectSurfaceFaces(roofInnerFaces, isRoof, true)
  if (!wallOuter || !wallInner || !roofOuter || !roofInner) {
    return { status: 'blocked', message: 'A canonical wall or roof surface is missing.' }
  }

  const wallOuterBoundary = boundaryEdges(wallOuter)
  const wallInnerBoundary = boundaryEdges(wallInner)
  const roofOuterBoundary = boundaryEdges(roofOuter)
  const roofInnerBoundary = boundaryEdges(roofInner)
  if (!wallOuterBoundary || !wallInnerBoundary || !roofOuterBoundary || !roofInnerBoundary) {
    return { status: 'blocked', message: 'A canonical surface has invalid edge incidence.' }
  }

  const outerWallLoops = splitWallBoundary(wallOuterBoundary)
  const innerWallLoops = splitWallBoundary(wallInnerBoundary)
  if (!outerWallLoops || !innerWallLoops) {
    return { status: 'blocked', message: 'A wall surface does not expose top and bottom loops.' }
  }

  const bottomRing = bridgeBoundaries(outerWallLoops.bottom, innerWallLoops.bottom)
  const outerRoofJoin = bridgeBoundaries(outerWallLoops.top, roofOuterBoundary)
  const innerRoofJoin = bridgeBoundaries(innerWallLoops.top, roofInnerBoundary)
  if (!bottomRing) {
    return {
      status: 'blocked',
      message: `Outer and inner wall bottoms have incompatible edge counts (${outerWallLoops.bottom.length} and ${innerWallLoops.bottom.length}).`,
    }
  }
  if (!outerRoofJoin) {
    return {
      status: 'blocked',
      message: `Outer wall and roof boundaries have incompatible edge counts (${outerWallLoops.top.length} and ${roofOuterBoundary.length}).`,
    }
  }
  if (!innerRoofJoin) {
    return {
      status: 'blocked',
      message: `Inner wall and roof boundaries have incompatible edge counts (${innerWallLoops.top.length} and ${roofInnerBoundary.length}).`,
    }
  }

  const geometry = geometryFromFaces([
    ...wallOuter,
    ...roofOuter,
    ...wallInner,
    ...roofInner,
    ...bottomRing,
    ...outerRoofJoin,
    ...innerRoofJoin,
  ])
  return geometry
    ? { status: 'ready', geometry }
    : { status: 'blocked', message: 'A canonical print face could not be triangulated.' }
}

function getVolumeFaces(
  node: RoofSegmentNode,
  options: { widthExtension: number; verticalOffset: number; isVoid: boolean },
): RoofFace[] {
  const { activeRh, tanTheta } = getSegmentSlopeFrame(node)
  const width = Math.max(0.01, node.width + options.widthExtension * 2)
  const depth = Math.max(0.01, node.depth + options.widthExtension * 2)
  const autoDrop = options.widthExtension * tanTheta
  const wallHeight = Math.max(0.01, node.wallHeight - autoDrop + options.verticalOffset)
  const roofHeight =
    activeRh > 0 ? activeRh + autoDrop * (node.roofType === 'shed' ? 2 : 1) : activeRh
  const shapeRatios = getRoofShapeRatios(node)
  const dutchInset =
    Math.min(node.width, node.depth) * node.dutchHipWidthRatio +
    (options.isVoid ? node.deckThickness : 0)

  return getRoofModuleFaces({
    type: node.roofType,
    w: width,
    d: depth,
    wh: wallHeight,
    rh: roofHeight,
    baseY: 0,
    insets: { dutchI: dutchInset },
    baseW: node.width,
    baseD: node.depth,
    tanTheta,
    shapeRatios,
    dutchTopRakeThickness: node.dutchTopRakeThickness,
  })
}

function getShingleOuterFaces(node: RoofSegmentNode): RoofFace[] {
  const { activeRh, tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(node)
  const shapeRatios = getRoofShapeRatios(node)
  const horizontalOverhang = node.overhang * cosTheta
  const deckExtension = node.wallThickness / 2 + horizontalOverhang
  const deckVerticalThickness = activeRh > 0 ? node.deckThickness / cosTheta : node.deckThickness
  const deckDrop = deckExtension * tanTheta
  const shingleHorizontalThickness = node.shingleThickness * sinTheta
  const shingleVerticalThickness = node.shingleThickness * cosTheta
  const baseWidth = Math.max(0.01, node.width + deckExtension * 2)
  const baseDepth = Math.max(0.01, node.depth + deckExtension * 2)
  const baseWallHeight = node.wallHeight - deckDrop + deckVerticalThickness
  const baseRoofHeight =
    activeRh > 0 ? activeRh + deckDrop * (node.roofType === 'shed' ? 2 : 1) : activeRh
  let width = baseWidth
  let depth = baseDepth
  let translateZ = 0

  if (['hip', 'mansard', 'dutch'].includes(node.roofType)) {
    width += shingleHorizontalThickness * 2
    depth += shingleHorizontalThickness * 2
  } else if (['gable', 'gambrel'].includes(node.roofType)) {
    depth += shingleHorizontalThickness * 2
  } else if (node.roofType === 'shed') {
    depth += shingleHorizontalThickness
    translateZ = shingleHorizontalThickness / 2
  }

  const wallHeight = baseWallHeight + shingleVerticalThickness
  const roofHeight =
    activeRh > 0 ? baseRoofHeight + shingleHorizontalThickness * tanTheta : baseRoofHeight
  const insets = getRoofShapeInsets({
    roofType: node.roofType,
    width: node.width,
    depth: node.depth,
    wh: wallHeight,
    baseY: 0,
    isVoid: false,
    brushW: width,
    brushD: depth,
    tanTheta,
    shingleThickness: node.shingleThickness,
    dutchHipWidthRatio: node.dutchHipWidthRatio,
  })

  const faces = getRoofModuleFaces({
    type: node.roofType,
    w: width,
    d: depth,
    wh: wallHeight,
    rh: roofHeight,
    baseY: 0,
    insets,
    baseW: node.width,
    baseD: node.depth,
    tanTheta,
    shapeRatios,
    dutchTopRakeThickness: node.dutchTopRakeThickness,
  })

  if (translateZ === 0) return faces
  return faces.map((face) => face.map((point) => ({ ...point, z: point.z + translateZ })))
}

function blockingDiagnostics(
  node: RoofSegmentNode,
  nodes: Record<string, AnyNode> | undefined,
): PrintRoofSolidDiagnostic[] {
  const diagnostics: PrintRoofSolidDiagnostic[] = []
  const dimensions = [
    node.width,
    node.depth,
    node.wallHeight,
    node.wallThickness,
    node.deckThickness,
    node.overhang,
    node.shingleThickness,
  ]
  if (
    dimensions.some((value) => !Number.isFinite(value) || value < 0) ||
    node.width <= FACE_EPSILON ||
    node.depth <= FACE_EPSILON ||
    node.wallThickness <= FACE_EPSILON ||
    node.deckThickness + node.shingleThickness <= FACE_EPSILON
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'invalid_roof_print_dimensions',
      message: `Roof segment ${node.id} needs positive footprint, wall, and roof-cover thickness for print compilation.`,
      nodeIds: [node.id],
    })
  }

  const trim = normalizeRoofSegmentTrim(node)
  if (Object.values(trim).some((value) => value > FACE_EPSILON)) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported_roof_print_trim',
      message: `Roof segment ${node.id} has trim cuts that do not yet have a manifold print fixture.`,
      nodeIds: [node.id],
    })
  }

  const cutNodeIds: string[] = []
  for (const childId of node.children) {
    const child = nodes?.[childId]
    if (!child) {
      cutNodeIds.push(childId)
      continue
    }
    const definition = nodeRegistry.get(child.type)
    const roofAccessory = definition?.capabilities.roofAccessory
    if (!roofAccessory || roofAccessory.buildCut) {
      cutNodeIds.push(child.id)
    }
  }
  if (cutNodeIds.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported_roof_print_cut',
      message: `Roof segment ${node.id} has unresolved, unregistered, or cutting accessories that do not yet have a manifold print fixture.`,
      nodeIds: [node.id, ...cutNodeIds].sort(),
    })
  }

  return diagnostics
}

export function buildPrintableRoofSegmentSolids(
  node: RoofSegmentNode,
  nodes?: Record<string, AnyNode>,
): PrintRoofSolidResult {
  const diagnostics = blockingDiagnostics(node, nodes)
  if (diagnostics.length > 0) return { status: 'blocked', object: null, diagnostics }

  const { cosTheta } = getSegmentSlopeFrame(node)
  const wallOuter = getVolumeFaces(node, {
    widthExtension: node.wallThickness / 2,
    verticalOffset: 0,
    isVoid: false,
  })
  const wallInner = getVolumeFaces(node, {
    widthExtension: -node.wallThickness / 2,
    verticalOffset: 0,
    isVoid: false,
  })
  const deckExtension = node.wallThickness / 2 + node.overhang * cosTheta
  const roofInner = getVolumeFaces(node, {
    widthExtension: deckExtension,
    verticalOffset: 0,
    isVoid: true,
  })
  const roofOuter = getShingleOuterFaces(node)
  const geometryResult = buildRoofModuleGeometry(wallOuter, wallInner, roofOuter, roofInner)
  if (geometryResult.status === 'blocked') {
    return {
      status: 'blocked',
      object: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'roof_print_topology_mismatch',
          message: `Roof segment ${node.id} cannot form one closed print module. ${geometryResult.message}`,
          nodeIds: [node.id],
        },
      ],
    }
  }

  const root = new THREE.Group()
  root.name = 'print-roof-segment-solids'
  root.userData = { pascalId: node.id }
  root.position.set(node.position[0], node.position[1], node.position[2])
  root.rotation.y = node.rotation

  const mesh = new THREE.Mesh(geometryResult.geometry)
  mesh.name = 'print-roof-shell'
  root.add(mesh)

  return { status: 'ready', object: root, diagnostics: [] }
}
