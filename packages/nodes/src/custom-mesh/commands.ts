import {
  type CustomMeshEdge,
  type CustomMeshFace,
  type CustomMeshTopology,
  type CustomMeshVertex,
  inspectCustomMeshTopology,
} from '@pascal-app/core'
import type { CustomMeshSelection } from './selection-model'

export type { CustomMeshSelection } from './selection-model'

type Point = [number, number, number]

export type CustomMeshCommand =
  | {
      type: 'extrude-face'
      faceId: string
      distance: number
    }
  | {
      type: 'translate-components'
      selection: CustomMeshSelection
      delta: Point
    }
  | {
      type: 'rotate-components'
      selection: CustomMeshSelection
      pivot: Point
      axis: Point
      angle: number
    }
  | {
      type: 'scale-components'
      selection: CustomMeshSelection
      pivot: Point
      factors: Point
    }
  | {
      type: 'inset-face'
      faceId: string
      amount: number
      depth: number
    }
  | {
      type: 'delete-components'
      selection: CustomMeshSelection
    }
  | {
      type: 'merge-vertices'
      vertexIds: string[]
    }
  | {
      type: 'dissolve-edge'
      edgeId: string
    }
  | {
      type: 'loop-cut'
      edgeId: string
      factor: number
      cuts?: number
    }
  | {
      type: 'bevel-edge'
      edgeId: string
      width: number
      segments: number
      profile: number
      clampOverlap: boolean
    }

export type CustomMeshCommandResult =
  | { ok: true; topology: CustomMeshTopology; selection: CustomMeshSelection }
  | { ok: false; error: string }

function normalize(point: Point): Point | null {
  const length = Math.hypot(point[0], point[1], point[2])
  if (length < 1e-8) return null
  return [point[0] / length, point[1] / length, point[2] / length]
}

export function customMeshFaceNormal(
  topology: CustomMeshTopology,
  face: CustomMeshFace,
): Point | null {
  const vertices = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const positions = face.vertexIds
    .map((id) => vertices.get(id))
    .filter((value): value is Point => !!value)
  if (positions.length < 3) return null

  const normal: Point = [0, 0, 0]
  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index]!
    const next = positions[(index + 1) % positions.length]!
    normal[0] += (current[1] - next[1]) * (current[2] + next[2])
    normal[1] += (current[2] - next[2]) * (current[0] + next[0])
    normal[2] += (current[0] - next[0]) * (current[1] + next[1])
  }
  return normalize(normal)
}

export function customMeshFaceCentroid(
  topology: CustomMeshTopology,
  face: CustomMeshFace,
): Point | null {
  const vertices = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const positions = face.vertexIds
    .map((id) => vertices.get(id))
    .filter((value): value is Point => !!value)
  if (positions.length !== face.vertexIds.length || positions.length === 0) return null
  const total = positions.reduce<Point>(
    (sum, position) => [sum[0] + position[0], sum[1] + position[1], sum[2] + position[2]],
    [0, 0, 0],
  )
  return [total[0] / positions.length, total[1] / positions.length, total[2] / positions.length]
}

function nextNumericId(prefix: string, ids: readonly string[]): () => string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  let next = ids.reduce((highest, id) => {
    const match = pattern.exec(id)
    return match ? Math.max(highest, Number(match[1]) + 1) : highest
  }, 0)
  const occupied = new Set(ids)
  return () => {
    let candidate = `${prefix}${next++}`
    while (occupied.has(candidate)) candidate = `${prefix}${next++}`
    occupied.add(candidate)
    return candidate
  }
}

const topologyEdgeKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

type LoopCutStep = {
  faceId: string
  fromEdgeId: string
  toEdgeId: string
}

type LoopCutRing = {
  steps: LoopCutStep[]
  orientedEdgeVertices: Map<string, [string, string]>
}

function oppositeOrientedEdgeVertices(
  face: CustomMeshFace,
  orientedVertices: [string, string],
): [string, string] | null {
  if (face.vertexIds.length !== 4) return null
  const [from, to] = orientedVertices
  const index = face.vertexIds.indexOf(from)
  if (index < 0) return null
  if (face.vertexIds[(index + 1) % 4] === to) {
    return [face.vertexIds[(index + 3) % 4]!, face.vertexIds[(index + 2) % 4]!]
  }
  if (face.vertexIds[(index + 3) % 4] === to) {
    return [face.vertexIds[(index + 1) % 4]!, face.vertexIds[(index + 2) % 4]!]
  }
  return null
}

function resolveLoopCutRing(topology: CustomMeshTopology, edgeId: string): LoopCutRing | null {
  const startEdge = topology.edges.find((edge) => edge.id === edgeId)
  if (!startEdge) return null
  const edgeByKey = new Map(
    topology.edges.map((edge) => [topologyEdgeKey(...edge.vertexIds), edge] as const),
  )
  const facesByEdgeId = new Map<string, CustomMeshFace[]>()
  for (const face of topology.faces) {
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const edge = edgeByKey.get(
        topologyEdgeKey(
          face.vertexIds[index]!,
          face.vertexIds[(index + 1) % face.vertexIds.length]!,
        ),
      )
      if (!edge) return null
      const faces = facesByEdgeId.get(edge.id) ?? []
      faces.push(face)
      facesByEdgeId.set(edge.id, faces)
    }
  }
  const incidentStartFaces = facesByEdgeId.get(startEdge.id) ?? []
  if (incidentStartFaces.length === 0 || incidentStartFaces.length > 2) return null
  const startFaces = incidentStartFaces.filter((face) => face.vertexIds.length === 4)
  if (startFaces.length === 0) return null

  const orientedEdgeVertices = new Map<string, [string, string]>([
    [startEdge.id, startEdge.vertexIds],
  ])
  const queue = startFaces.map((face) => ({
    edgeId: startEdge.id,
    faceId: face.id,
  }))
  const visitedFaces = new Set<string>()
  const steps: LoopCutStep[] = []

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visitedFaces.has(current.faceId)) continue
    const face = topology.faces.find((entry) => entry.id === current.faceId)
    const orientedVertices = orientedEdgeVertices.get(current.edgeId)
    if (!(face && orientedVertices) || face.vertexIds.length !== 4) return null
    const oppositeVertices = oppositeOrientedEdgeVertices(face, orientedVertices)
    if (!oppositeVertices) return null
    const oppositeEdge = edgeByKey.get(topologyEdgeKey(...oppositeVertices))
    if (!oppositeEdge) return null
    const existingOrientation = orientedEdgeVertices.get(oppositeEdge.id)
    if (
      existingOrientation &&
      (existingOrientation[0] !== oppositeVertices[0] ||
        existingOrientation[1] !== oppositeVertices[1])
    ) {
      return null
    }
    orientedEdgeVertices.set(oppositeEdge.id, oppositeVertices)
    visitedFaces.add(face.id)
    steps.push({
      faceId: face.id,
      fromEdgeId: current.edgeId,
      toEdgeId: oppositeEdge.id,
    })

    const adjacentFaces = facesByEdgeId.get(oppositeEdge.id) ?? []
    if (adjacentFaces.length > 2) return null
    for (const adjacentFace of adjacentFaces) {
      if (adjacentFace.id === face.id || visitedFaces.has(adjacentFace.id)) continue
      if (adjacentFace.vertexIds.length !== 4) continue
      queue.push({ edgeId: oppositeEdge.id, faceId: adjacentFace.id })
    }
  }

  return steps.length > 0 ? { steps, orientedEdgeVertices } : null
}

function interpolatePoint(from: Point, to: Point, factor: number): Point {
  return [
    from[0] + (to[0] - from[0]) * factor,
    from[1] + (to[1] - from[1]) * factor,
    from[2] + (to[2] - from[2]) * factor,
  ]
}

export function customMeshLoopCutSegments(
  topology: CustomMeshTopology,
  edgeId: string,
  factor: number,
  cuts = 1,
): [Point, Point][] | null {
  const ring = resolveLoopCutRing(topology, edgeId)
  const fractions = loopCutFractions(factor, cuts)
  if (!ring || !fractions) return null
  const vertexById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const pointByEdgeId = new Map<string, Point[]>()
  for (const [ringEdgeId, [fromId, toId]] of ring.orientedEdgeVertices) {
    const from = vertexById.get(fromId)
    const to = vertexById.get(toId)
    if (!(from && to)) return null
    pointByEdgeId.set(
      ringEdgeId,
      fractions.map((fraction) => interpolatePoint(from, to, fraction)),
    )
  }
  return ring.steps.flatMap((step) =>
    fractions.map((_, index) => [
      pointByEdgeId.get(step.fromEdgeId)![index]!,
      pointByEdgeId.get(step.toEdgeId)![index]!,
    ]),
  )
}

function loopCutFractions(factor: number, cuts: number): number[] | null {
  const count = Math.floor(cuts)
  if (
    !Number.isFinite(factor) ||
    factor <= 0 ||
    factor >= 1 ||
    !Number.isFinite(cuts) ||
    count < 1 ||
    count > 32
  )
    return null
  if (count === 1) return [factor]
  const spacing = 1 / (count + 1)
  const offset = (factor - 0.5) * spacing * 1.96
  return Array.from({ length: count }, (_, index) => (index + 1) * spacing + offset)
}

function augmentFaceLoop(
  face: CustomMeshFace,
  cutVerticesByEdgeKey: ReadonlyMap<string, { edgeOrder: [string, string]; ids: string[] }>,
): string[] {
  const augmented: string[] = []
  for (let index = 0; index < face.vertexIds.length; index += 1) {
    const current = face.vertexIds[index]!
    const next = face.vertexIds[(index + 1) % face.vertexIds.length]!
    augmented.push(current)
    const cuts = cutVerticesByEdgeKey.get(topologyEdgeKey(current, next))
    if (!cuts) continue
    augmented.push(...(cuts.edgeOrder[0] === current ? cuts.ids : [...cuts.ids].reverse()))
  }
  return augmented
}

function splitLoopByChord(loop: string[], firstCutId: string, secondCutId: string) {
  const firstIndex = loop.indexOf(firstCutId)
  const secondIndex = loop.indexOf(secondCutId)
  if (firstIndex < 0 || secondIndex < 0) return null
  const walk = (start: number, end: number) => {
    const result: string[] = []
    for (let index = start; ; index = (index + 1) % loop.length) {
      result.push(loop[index]!)
      if (index === end) return result
    }
  }
  const first = walk(firstIndex, secondIndex)
  const second = walk(secondIndex, firstIndex)
  return first.length >= 3 && second.length >= 3 ? [first, second] : null
}

function loopCut(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'loop-cut' }>,
): CustomMeshCommandResult {
  const fractions = loopCutFractions(command.factor, command.cuts ?? 1)
  if (!fractions)
    return {
      ok: false,
      error: 'Loop cut requires 1–32 cuts and a factor between 0 and 1',
    }
  const ring = resolveLoopCutRing(topology, command.edgeId)
  if (!ring)
    return {
      ok: false,
      error: 'Loop cut requires a connected ring of quad faces',
    }
  const vertexById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex]))
  const edgeById = new Map(topology.edges.map((edge) => [edge.id, edge]))
  const allocateVertexId = nextNumericId(
    'v',
    topology.vertices.map((vertex) => vertex.id),
  )
  const allocateEdgeId = nextNumericId(
    'e',
    topology.edges.map((edge) => edge.id),
  )
  const allocateFaceId = nextNumericId(
    'f',
    topology.faces.map((face) => face.id),
  )
  const cutVerticesByEdgeId = new Map<string, string[]>()
  const cutVerticesByEdgeKey = new Map<string, { edgeOrder: [string, string]; ids: string[] }>()
  const newVertices: CustomMeshVertex[] = []

  for (const [ringEdgeId, [fromId, toId]] of ring.orientedEdgeVertices) {
    const from = vertexById.get(fromId)
    const to = vertexById.get(toId)
    const edge = edgeById.get(ringEdgeId)
    if (!(from && to && edge)) return { ok: false, error: 'Loop cut references missing topology' }
    const ids = fractions.map(() => allocateVertexId())
    cutVerticesByEdgeId.set(ringEdgeId, ids)
    const edgeOrderIds = edge.vertexIds[0] === fromId ? ids : [...ids].reverse()
    cutVerticesByEdgeKey.set(topologyEdgeKey(...edge.vertexIds), {
      edgeOrder: edge.vertexIds,
      ids: edgeOrderIds,
    })
    newVertices.push(
      ...ids.map((id, index) => ({
        id,
        position: interpolatePoint(from.position, to.position, fractions[index]!),
      })),
    )
  }

  const splitBoundaryEdges = topology.edges.flatMap<CustomMeshEdge>((edge) => {
    const cutIds = cutVerticesByEdgeKey.get(topologyEdgeKey(...edge.vertexIds))?.ids
    if (!cutIds) return [edge]
    const chain = [edge.vertexIds[0], ...cutIds, edge.vertexIds[1]]
    return chain.slice(0, -1).map((vertexId, index) => ({
      id: index === 0 ? edge.id : allocateEdgeId(),
      vertexIds: [vertexId, chain[index + 1]!],
    }))
  })
  const stepByFaceId = new Map(ring.steps.map((step) => [step.faceId, step] as const))
  const cutEdgeIds: string[] = []
  const cutEdges: CustomMeshEdge[] = []
  const faces: CustomMeshFace[] = []
  for (const face of topology.faces) {
    const step = stepByFaceId.get(face.id)
    if (!step) {
      const vertexIds = augmentFaceLoop(face, cutVerticesByEdgeKey)
      faces.push(vertexIds.length === face.vertexIds.length ? face : { ...face, vertexIds })
      continue
    }
    const fromCutIds = cutVerticesByEdgeId.get(step.fromEdgeId)
    const toCutIds = cutVerticesByEdgeId.get(step.toEdgeId)
    if (!(fromCutIds && toCutIds))
      return { ok: false, error: 'Loop cut references missing topology' }
    let remaining = augmentFaceLoop(face, cutVerticesByEdgeKey)
    const splitLoops: string[][] = []
    for (let index = 0; index < fromCutIds.length; index += 1) {
      const fromCutId = fromCutIds[index]!
      const toCutId = toCutIds[index]!
      const pair = splitLoopByChord(remaining, fromCutId, toCutId)
      if (!pair) return { ok: false, error: `Could not split quad face: ${face.id}` }
      const cutEdgeId = allocateEdgeId()
      cutEdgeIds.push(cutEdgeId)
      cutEdges.push({ id: cutEdgeId, vertexIds: [fromCutId, toCutId] })
      if (index === fromCutIds.length - 1) {
        splitLoops.push(...pair)
      } else {
        const nextFrom = fromCutIds[index + 1]!
        const nextTo = toCutIds[index + 1]!
        const remainingIndex = pair.findIndex(
          (candidate) => candidate.includes(nextFrom) && candidate.includes(nextTo),
        )
        if (remainingIndex < 0)
          return {
            ok: false,
            error: `Could not order cuts on quad face: ${face.id}`,
          }
        splitLoops.push(pair[1 - remainingIndex]!)
        remaining = pair[remainingIndex]!
      }
    }
    faces.push(
      ...splitLoops.map((vertexIds, index) => ({
        ...face,
        id: index === 0 ? face.id : allocateFaceId(),
        vertexIds,
      })),
    )
  }

  const nextTopology: CustomMeshTopology = {
    vertices: [...topology.vertices, ...newVertices],
    edges: [...splitBoundaryEdges, ...cutEdges],
    faces,
  }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  return {
    ok: true,
    topology: nextTopology,
    selection: { mode: 'edge', ids: cutEdgeIds },
  }
}

function bevelProfileFactor(value: number, profile: number): number {
  const exponent = 2 ** ((0.5 - profile) * 4)
  const a = value ** exponent
  const b = (1 - value) ** exponent
  return a / (a + b)
}

function roundedBevelPoint(origin: Point, start: Point, end: Point, factor: number): Point {
  const startDirection = normalize([
    start[0] - origin[0],
    start[1] - origin[1],
    start[2] - origin[2],
  ])
  const endDirection = normalize([end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]])
  if (!(startDirection && endDirection)) return interpolatePoint(start, end, factor)
  const directionDot = Math.max(
    -1,
    Math.min(
      1,
      startDirection[0] * endDirection[0] +
        startDirection[1] * endDirection[1] +
        startDirection[2] * endDirection[2],
    ),
  )
  if (directionDot < -0.999999) return interpolatePoint(start, end, factor)
  const width = Math.hypot(start[0] - origin[0], start[1] - origin[1], start[2] - origin[2])
  const centerScale = width / (1 + directionDot)
  const center: Point = [
    origin[0] + (startDirection[0] + endDirection[0]) * centerScale,
    origin[1] + (startDirection[1] + endDirection[1]) * centerScale,
    origin[2] + (startDirection[2] + endDirection[2]) * centerScale,
  ]
  const startRadius: Point = [start[0] - center[0], start[1] - center[1], start[2] - center[2]]
  const endRadius: Point = [end[0] - center[0], end[1] - center[1], end[2] - center[2]]
  const radius = Math.hypot(...startRadius)
  const endRadiusLength = Math.hypot(...endRadius)
  if (radius < 1e-8 || endRadiusLength < 1e-8) return interpolatePoint(start, end, factor)
  const radiusDot = Math.max(
    -1,
    Math.min(
      1,
      (startRadius[0] * endRadius[0] +
        startRadius[1] * endRadius[1] +
        startRadius[2] * endRadius[2]) /
        (radius * endRadiusLength),
    ),
  )
  const angle = Math.acos(radiusDot)
  const sine = Math.sin(angle)
  if (Math.abs(sine) < 1e-8) return interpolatePoint(start, end, factor)
  const startWeight = Math.sin((1 - factor) * angle) / sine
  const endWeight = Math.sin(factor * angle) / sine
  return [
    center[0] + startRadius[0] * startWeight + endRadius[0] * endWeight,
    center[1] + startRadius[1] * startWeight + endRadius[1] * endWeight,
    center[2] + startRadius[2] * startWeight + endRadius[2] * endWeight,
  ]
}

function rebuildEdgesFromFaces(
  topology: CustomMeshTopology,
  faces: CustomMeshFace[],
  allocateEdgeId: () => string,
): CustomMeshEdge[] {
  const oldByKey = new Map(
    topology.edges.map((edge) => [topologyEdgeKey(...edge.vertexIds), edge] as const),
  )
  const seen = new Set<string>()
  const edges: CustomMeshEdge[] = []
  for (const face of faces) {
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const vertexIds = [
        face.vertexIds[index]!,
        face.vertexIds[(index + 1) % face.vertexIds.length]!,
      ] as [string, string]
      const key = topologyEdgeKey(...vertexIds)
      if (seen.has(key)) continue
      seen.add(key)
      const old = oldByKey.get(key)
      edges.push(old ?? { id: allocateEdgeId(), vertexIds })
    }
  }
  return edges
}

function bevelEdge(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'bevel-edge' }>,
): CustomMeshCommandResult {
  const edge = topology.edges.find((entry) => entry.id === command.edgeId)
  if (!edge) return { ok: false, error: `Edge not found: ${command.edgeId}` }
  const segments = Math.floor(command.segments)
  if (!Number.isFinite(command.width) || command.width <= 0)
    return { ok: false, error: 'Bevel width must be positive' }
  if (!Number.isFinite(command.segments) || segments < 1 || segments > 12)
    return { ok: false, error: 'Bevel segments must be between 1 and 12' }
  if (!Number.isFinite(command.profile) || command.profile < 0 || command.profile > 1)
    return { ok: false, error: 'Bevel profile must be between 0 and 1' }

  const [aId, bId] = edge.vertexIds
  const adjacentFaces = topology.faces.filter((face) => faceContainsEdge(face, aId, bId))
  if (adjacentFaces.length !== 2)
    return {
      ok: false,
      error: 'Bevel requires an edge shared by exactly two faces',
    }
  const incidentAt = (id: string) => topology.faces.filter((face) => face.vertexIds.includes(id))
  const caps = [aId, bId].map((id) =>
    incidentAt(id).filter((face) => !adjacentFaces.some((adjacent) => adjacent.id === face.id)),
  )
  if (caps.some((faces) => faces.length !== 1))
    return {
      ok: false,
      error: 'Bevel currently requires three-face corner endpoints',
    }
  const vertexById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex]))
  const vertexA = vertexById.get(aId)
  const vertexB = vertexById.get(bId)
  if (!(vertexA && vertexB)) return { ok: false, error: 'Bevel edge references missing vertices' }

  const neighborInFace = (face: CustomMeshFace, id: string, other: string) => {
    const index = face.vertexIds.indexOf(id)
    const previous = face.vertexIds[(index - 1 + face.vertexIds.length) % face.vertexIds.length]!
    const next = face.vertexIds[(index + 1) % face.vertexIds.length]!
    return previous === other ? next : next === other ? previous : null
  }
  const neighbors = adjacentFaces.map((face) => ({
    a: neighborInFace(face, aId, bId),
    b: neighborInFace(face, bId, aId),
  }))
  if (neighbors.some((entry) => !(entry.a && entry.b)))
    return { ok: false, error: 'Could not resolve bevel corner neighbors' }
  const points = neighbors.flatMap((entry, faceIndex) =>
    (
      [
        ['a', aId],
        ['b', bId],
      ] as const
    ).map(([endpoint, endpointId]) => {
      const neighborId = entry[endpoint]!
      const origin = vertexById.get(endpointId)!.position
      const neighbor = vertexById.get(neighborId)?.position
      return neighbor ? { faceIndex, endpoint, origin, neighbor } : null
    }),
  )
  if (points.some((point) => !point))
    return { ok: false, error: 'Bevel references missing vertices' }
  const safeMaximum =
    Math.min(
      ...points.map((point) =>
        Math.hypot(
          point!.neighbor[0] - point!.origin[0],
          point!.neighbor[1] - point!.origin[1],
          point!.neighbor[2] - point!.origin[2],
        ),
      ),
    ) * 0.49
  const width = command.clampOverlap ? Math.min(command.width, safeMaximum) : command.width
  if (!command.clampOverlap && width >= safeMaximum * 2)
    return {
      ok: false,
      error: 'Bevel width overlaps adjacent edges; enable Clamp',
    }

  const offset = (origin: Point, neighbor: Point) => {
    const direction = normalize([
      neighbor[0] - origin[0],
      neighbor[1] - origin[1],
      neighbor[2] - origin[2],
    ])!
    return [
      origin[0] + direction[0] * width,
      origin[1] + direction[1] * width,
      origin[2] + direction[2] * width,
    ] as Point
  }
  const outerA = neighbors.map((entry) =>
    offset(vertexA.position, vertexById.get(entry.a!)!.position),
  )
  const outerB = neighbors.map((entry) =>
    offset(vertexB.position, vertexById.get(entry.b!)!.position),
  )
  const allocateVertexId = nextNumericId(
    'v',
    topology.vertices.map((vertex) => vertex.id),
  )
  const allocateEdgeId = nextNumericId(
    'e',
    topology.edges.map((entry) => entry.id),
  )
  const allocateFaceId = nextNumericId(
    'f',
    topology.faces.map((face) => face.id),
  )
  const railsA: string[] = []
  const railsB: string[] = []
  const newVertices: CustomMeshVertex[] = []
  for (let index = 0; index <= segments; index += 1) {
    const factor = bevelProfileFactor(index / segments, command.profile)
    const aVertexId = allocateVertexId()
    const bVertexId = allocateVertexId()
    railsA.push(aVertexId)
    railsB.push(bVertexId)
    newVertices.push(
      {
        id: aVertexId,
        position: roundedBevelPoint(vertexA.position, outerA[0]!, outerA[1]!, factor),
      },
      {
        id: bVertexId,
        position: roundedBevelPoint(vertexB.position, outerB[0]!, outerB[1]!, factor),
      },
    )
  }

  const replaceVertex = (loop: string[], id: string, replacement: string[]) =>
    loop.flatMap((vertexId) => (vertexId === id ? replacement : [vertexId]))
  const faces = topology.faces
    .filter((face) => !adjacentFaces.some((adjacent) => adjacent.id === face.id))
    .map((face) => {
      if (face.id === caps[0]![0]!.id) {
        const index = face.vertexIds.indexOf(aId)
        const previous = face.vertexIds[(index - 1 + face.vertexIds.length) % face.vertexIds.length]
        const replacement = previous === neighbors[0]!.a ? railsA : [...railsA].reverse()
        return {
          ...face,
          vertexIds: replaceVertex(face.vertexIds, aId, replacement),
        }
      }
      if (face.id === caps[1]![0]!.id) {
        const index = face.vertexIds.indexOf(bId)
        const previous = face.vertexIds[(index - 1 + face.vertexIds.length) % face.vertexIds.length]
        const replacement = previous === neighbors[0]!.b ? railsB : [...railsB].reverse()
        return {
          ...face,
          vertexIds: replaceVertex(face.vertexIds, bId, replacement),
        }
      }
      return face
    })
  for (let faceIndex = 0; faceIndex < 2; faceIndex += 1) {
    const source = adjacentFaces[faceIndex]!
    faces.push({
      ...source,
      vertexIds: source.vertexIds.map((id) =>
        id === aId
          ? railsA[faceIndex === 0 ? 0 : segments]!
          : id === bId
            ? railsB[faceIndex === 0 ? 0 : segments]!
            : id,
      ),
    })
  }
  const firstFaceForward = adjacentFaces[0]!.vertexIds.some(
    (id, index) =>
      id === aId &&
      adjacentFaces[0]!.vertexIds[(index + 1) % adjacentFaces[0]!.vertexIds.length] === bId,
  )
  for (let index = 0; index < segments; index += 1) {
    const vertexIds = firstFaceForward
      ? [railsB[index]!, railsA[index]!, railsA[index + 1]!, railsB[index + 1]!]
      : [railsA[index]!, railsB[index]!, railsB[index + 1]!, railsA[index + 1]!]
    faces.push({
      id: allocateFaceId(),
      vertexIds,
      materialSlot: adjacentFaces[0]!.materialSlot,
    })
  }
  const nextTopology: CustomMeshTopology = {
    vertices: [
      ...topology.vertices.filter((vertex) => vertex.id !== aId && vertex.id !== bId),
      ...newVertices,
    ],
    edges: rebuildEdgesFromFaces(topology, faces, allocateEdgeId),
    faces,
  }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  const selected = nextTopology.edges.filter((entry) => {
    const aRail = railsA.includes(entry.vertexIds[0]) && railsB.includes(entry.vertexIds[1])
    const bRail = railsB.includes(entry.vertexIds[0]) && railsA.includes(entry.vertexIds[1])
    return aRail || bRail
  })
  return {
    ok: true,
    topology: nextTopology,
    selection: { mode: 'edge', ids: selected.map((entry) => entry.id) },
  }
}

function extrudeFace(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'extrude-face' }>,
): CustomMeshCommandResult {
  const faceIndex = topology.faces.findIndex((face) => face.id === command.faceId)
  const face = topology.faces[faceIndex]
  if (!face) return { ok: false, error: `Face not found: ${command.faceId}` }
  if (!Number.isFinite(command.distance) || Math.abs(command.distance) < 1e-6) {
    return {
      ok: false,
      error: 'Extrude distance must be a non-zero finite number',
    }
  }
  const normal = customMeshFaceNormal(topology, face)
  if (!normal) return { ok: false, error: `Face has no usable normal: ${face.id}` }

  const verticesById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex]))
  const allocateVertexId = nextNumericId(
    'v',
    topology.vertices.map((vertex) => vertex.id),
  )
  const allocateEdgeId = nextNumericId(
    'e',
    topology.edges.map((edge) => edge.id),
  )
  const allocateFaceId = nextNumericId(
    'f',
    topology.faces.map((entry) => entry.id),
  )
  const duplicateIds = new Map<string, string>()
  const newVertices: CustomMeshVertex[] = []

  for (const vertexId of face.vertexIds) {
    const vertex = verticesById.get(vertexId)
    if (!vertex)
      return {
        ok: false,
        error: `Face references missing vertex: ${vertexId}`,
      }
    const id = allocateVertexId()
    duplicateIds.set(vertexId, id)
    newVertices.push({
      id,
      position: [
        vertex.position[0] + normal[0] * command.distance,
        vertex.position[1] + normal[1] * command.distance,
        vertex.position[2] + normal[2] * command.distance,
      ],
    })
  }

  const capVertexIds = face.vertexIds.map((vertexId) => duplicateIds.get(vertexId)!)
  const newEdges: CustomMeshEdge[] = []
  const sideFaces: CustomMeshFace[] = []
  for (let index = 0; index < face.vertexIds.length; index += 1) {
    const a = face.vertexIds[index]!
    const b = face.vertexIds[(index + 1) % face.vertexIds.length]!
    const newA = duplicateIds.get(a)!
    const newB = duplicateIds.get(b)!
    newEdges.push({ id: allocateEdgeId(), vertexIds: [newA, newB] })
    newEdges.push({ id: allocateEdgeId(), vertexIds: [a, newA] })
    sideFaces.push({
      id: allocateFaceId(),
      vertexIds: [a, b, newB, newA],
      materialSlot: face.materialSlot,
    })
  }

  const faces = topology.faces.slice()
  faces[faceIndex] = { ...face, vertexIds: capVertexIds }
  const nextTopology: CustomMeshTopology = {
    vertices: [...topology.vertices, ...newVertices],
    edges: [...topology.edges, ...newEdges],
    faces: [...faces, ...sideFaces],
  }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  return {
    ok: true,
    topology: nextTopology,
    selection: { mode: 'face', ids: [face.id] },
  }
}

export function customMeshSelectionVertexIds(
  topology: CustomMeshTopology,
  selection: CustomMeshSelection,
): Set<string> {
  const selectedIds = new Set(selection.ids)
  switch (selection.mode) {
    case 'vertex':
      return new Set(
        topology.vertices.filter((vertex) => selectedIds.has(vertex.id)).map((v) => v.id),
      )
    case 'edge': {
      const vertices = new Set<string>()
      for (const edge of topology.edges) {
        if (!selectedIds.has(edge.id)) continue
        vertices.add(edge.vertexIds[0])
        vertices.add(edge.vertexIds[1])
      }
      return vertices
    }
    case 'face': {
      const vertices = new Set<string>()
      for (const face of topology.faces) {
        if (!selectedIds.has(face.id)) continue
        for (const vertexId of face.vertexIds) vertices.add(vertexId)
      }
      return vertices
    }
  }
}

function translateComponents(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'translate-components' }>,
): CustomMeshCommandResult {
  if (command.delta.some((value) => !Number.isFinite(value))) {
    return {
      ok: false,
      error: 'Translation delta must contain finite numbers',
    }
  }
  const vertexIds = customMeshSelectionVertexIds(topology, command.selection)
  if (vertexIds.size === 0) return { ok: false, error: 'Select a component to move' }

  const nextTopology: CustomMeshTopology = {
    ...topology,
    vertices: topology.vertices.map((vertex) =>
      vertexIds.has(vertex.id)
        ? {
            ...vertex,
            position: [
              vertex.position[0] + command.delta[0],
              vertex.position[1] + command.delta[1],
              vertex.position[2] + command.delta[2],
            ],
          }
        : vertex,
    ),
  }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  return { ok: true, topology: nextTopology, selection: command.selection }
}

function transformComponents(
  topology: CustomMeshTopology,
  selection: CustomMeshSelection,
  transform: (position: Point) => Point,
): CustomMeshCommandResult {
  const vertexIds = customMeshSelectionVertexIds(topology, selection)
  if (vertexIds.size === 0) return { ok: false, error: 'Select a component to transform' }
  const nextTopology: CustomMeshTopology = {
    ...topology,
    vertices: topology.vertices.map((vertex) =>
      vertexIds.has(vertex.id) ? { ...vertex, position: transform(vertex.position) } : vertex,
    ),
  }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  return { ok: true, topology: nextTopology, selection }
}

function rotateComponents(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'rotate-components' }>,
): CustomMeshCommandResult {
  if (!Number.isFinite(command.angle) || command.pivot.some((value) => !Number.isFinite(value))) {
    return { ok: false, error: 'Rotation requires a finite angle and pivot' }
  }
  const axis = normalize(command.axis)
  if (!axis) return { ok: false, error: 'Rotation axis must be non-zero' }
  const cosine = Math.cos(command.angle)
  const sine = Math.sin(command.angle)
  return transformComponents(topology, command.selection, (position) => {
    const x = position[0] - command.pivot[0]
    const y = position[1] - command.pivot[1]
    const z = position[2] - command.pivot[2]
    const dot = axis[0] * x + axis[1] * y + axis[2] * z
    const cross: Point = [
      axis[1] * z - axis[2] * y,
      axis[2] * x - axis[0] * z,
      axis[0] * y - axis[1] * x,
    ]
    return [
      command.pivot[0] + x * cosine + cross[0] * sine + axis[0] * dot * (1 - cosine),
      command.pivot[1] + y * cosine + cross[1] * sine + axis[1] * dot * (1 - cosine),
      command.pivot[2] + z * cosine + cross[2] * sine + axis[2] * dot * (1 - cosine),
    ]
  })
}

function scaleComponents(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'scale-components' }>,
): CustomMeshCommandResult {
  if (
    command.pivot.some((value) => !Number.isFinite(value)) ||
    command.factors.some((value) => !Number.isFinite(value) || Math.abs(value) < 1e-6)
  ) {
    return {
      ok: false,
      error: 'Scale requires finite, non-zero factors and a finite pivot',
    }
  }
  return transformComponents(topology, command.selection, (position) => [
    command.pivot[0] + (position[0] - command.pivot[0]) * command.factors[0],
    command.pivot[1] + (position[1] - command.pivot[1]) * command.factors[1],
    command.pivot[2] + (position[2] - command.pivot[2]) * command.factors[2],
  ])
}

function insetFace(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'inset-face' }>,
): CustomMeshCommandResult {
  const faceIndex = topology.faces.findIndex((face) => face.id === command.faceId)
  const face = topology.faces[faceIndex]
  if (!face) return { ok: false, error: `Face not found: ${command.faceId}` }
  if (!Number.isFinite(command.amount) || command.amount <= 0 || command.amount >= 1) {
    return {
      ok: false,
      error: 'Inset amount must be greater than 0 and less than 1',
    }
  }
  if (!Number.isFinite(command.depth)) return { ok: false, error: 'Inset depth must be finite' }
  const centroid = customMeshFaceCentroid(topology, face)
  const normal = customMeshFaceNormal(topology, face)
  if (!(centroid && normal)) return { ok: false, error: `Face cannot be inset: ${face.id}` }

  const verticesById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex]))
  const allocateVertexId = nextNumericId(
    'v',
    topology.vertices.map((vertex) => vertex.id),
  )
  const allocateEdgeId = nextNumericId(
    'e',
    topology.edges.map((edge) => edge.id),
  )
  const allocateFaceId = nextNumericId(
    'f',
    topology.faces.map((entry) => entry.id),
  )
  const insetIds: string[] = []
  const newVertices: CustomMeshVertex[] = []
  for (const vertexId of face.vertexIds) {
    const vertex = verticesById.get(vertexId)
    if (!vertex)
      return {
        ok: false,
        error: `Face references missing vertex: ${vertexId}`,
      }
    const id = allocateVertexId()
    insetIds.push(id)
    newVertices.push({
      id,
      position: [
        vertex.position[0] +
          (centroid[0] - vertex.position[0]) * command.amount +
          normal[0] * command.depth,
        vertex.position[1] +
          (centroid[1] - vertex.position[1]) * command.amount +
          normal[1] * command.depth,
        vertex.position[2] +
          (centroid[2] - vertex.position[2]) * command.amount +
          normal[2] * command.depth,
      ],
    })
  }

  const newEdges: CustomMeshEdge[] = []
  const ringFaces: CustomMeshFace[] = []
  for (let index = 0; index < face.vertexIds.length; index += 1) {
    const oldA = face.vertexIds[index]!
    const oldB = face.vertexIds[(index + 1) % face.vertexIds.length]!
    const insetA = insetIds[index]!
    const insetB = insetIds[(index + 1) % insetIds.length]!
    newEdges.push({ id: allocateEdgeId(), vertexIds: [insetA, insetB] })
    newEdges.push({ id: allocateEdgeId(), vertexIds: [oldA, insetA] })
    ringFaces.push({
      id: allocateFaceId(),
      vertexIds: [oldA, oldB, insetB, insetA],
      materialSlot: face.materialSlot,
    })
  }
  const faces = topology.faces.slice()
  faces[faceIndex] = { ...face, vertexIds: insetIds }
  const nextTopology: CustomMeshTopology = {
    vertices: [...topology.vertices, ...newVertices],
    edges: [...topology.edges, ...newEdges],
    faces: [...faces, ...ringFaces],
  }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  return {
    ok: true,
    topology: nextTopology,
    selection: { mode: 'face', ids: [face.id] },
  }
}

function deleteComponents(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'delete-components' }>,
): CustomMeshCommandResult {
  const selected = new Set(command.selection.ids)
  if (selected.size === 0) return { ok: false, error: 'Select a component to delete' }
  let vertices = topology.vertices
  let edges = topology.edges
  let faces = topology.faces

  if (command.selection.mode === 'face') {
    faces = faces.filter((face) => !selected.has(face.id))
  } else if (command.selection.mode === 'edge') {
    const removedKeys = new Set(
      edges
        .filter((edge) => selected.has(edge.id))
        .map((edge) =>
          edge.vertexIds[0] < edge.vertexIds[1]
            ? `${edge.vertexIds[0]}\u0000${edge.vertexIds[1]}`
            : `${edge.vertexIds[1]}\u0000${edge.vertexIds[0]}`,
        ),
    )
    edges = edges.filter((edge) => !selected.has(edge.id))
    faces = faces.filter((face) =>
      face.vertexIds.every((vertexId, index) => {
        const next = face.vertexIds[(index + 1) % face.vertexIds.length]!
        const key = vertexId < next ? `${vertexId}\u0000${next}` : `${next}\u0000${vertexId}`
        return !removedKeys.has(key)
      }),
    )
  } else {
    vertices = vertices.filter((vertex) => !selected.has(vertex.id))
    edges = edges.filter(
      (edge) => !selected.has(edge.vertexIds[0]) && !selected.has(edge.vertexIds[1]),
    )
    faces = faces.filter((face) => face.vertexIds.every((vertexId) => !selected.has(vertexId)))
  }

  const nextTopology = { vertices, edges, faces }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  return {
    ok: true,
    topology: nextTopology,
    selection: { mode: command.selection.mode, ids: [] },
  }
}

function mergeVertices(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'merge-vertices' }>,
): CustomMeshCommandResult {
  const selected = new Set(command.vertexIds)
  const selectedVertices = topology.vertices.filter((vertex) => selected.has(vertex.id))
  if (selectedVertices.length < 2)
    return { ok: false, error: 'Select at least two vertices to merge' }
  const keepId = selectedVertices[0]!.id
  const center = selectedVertices.reduce<Point>(
    (sum, vertex) => [
      sum[0] + vertex.position[0],
      sum[1] + vertex.position[1],
      sum[2] + vertex.position[2],
    ],
    [0, 0, 0],
  )
  center[0] /= selectedVertices.length
  center[1] /= selectedVertices.length
  center[2] /= selectedVertices.length
  const mapVertexId = (id: string) => (selected.has(id) ? keepId : id)

  const edgeKeys = new Set<string>()
  const edges = topology.edges.flatMap<CustomMeshEdge>((edge) => {
    const a = mapVertexId(edge.vertexIds[0])
    const b = mapVertexId(edge.vertexIds[1])
    if (a === b) return []
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
    if (edgeKeys.has(key)) return []
    edgeKeys.add(key)
    return [{ ...edge, vertexIds: [a, b] }]
  })

  const faces: CustomMeshFace[] = []
  for (const face of topology.faces) {
    const mapped = face.vertexIds.map(mapVertexId)
    const loop: string[] = []
    for (const id of mapped) {
      if (loop.at(-1) !== id) loop.push(id)
    }
    if (loop.length > 1 && loop[0] === loop.at(-1)) loop.pop()
    if (loop.length < 3 || new Set(loop).size < 3) continue
    if (new Set(loop).size !== loop.length) {
      return {
        ok: false,
        error: 'The selected vertices would create a repeated face vertex',
      }
    }
    faces.push({ ...face, vertexIds: loop })
  }

  const nextTopology: CustomMeshTopology = {
    vertices: topology.vertices
      .filter((vertex) => vertex.id === keepId || !selected.has(vertex.id))
      .map((vertex) => (vertex.id === keepId ? { ...vertex, position: center } : vertex)),
    edges,
    faces,
  }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  return {
    ok: true,
    topology: nextTopology,
    selection: { mode: 'vertex', ids: [keepId] },
  }
}

function faceContainsEdge(face: CustomMeshFace, a: string, b: string): boolean {
  return face.vertexIds.some((vertexId, index) => {
    const next = face.vertexIds[(index + 1) % face.vertexIds.length]
    return (vertexId === a && next === b) || (vertexId === b && next === a)
  })
}

function longFacePath(face: CustomMeshFace, start: string, end: string): string[] | null {
  const startIndex = face.vertexIds.indexOf(start)
  if (startIndex < 0) return null
  const forward: string[] = [start]
  for (let offset = 1; offset <= face.vertexIds.length; offset += 1) {
    const id = face.vertexIds[(startIndex + offset) % face.vertexIds.length]!
    forward.push(id)
    if (id === end) break
  }
  if (forward.at(-1) !== end) return null
  if (forward.length > 2) return forward

  const backward: string[] = [start]
  for (let offset = 1; offset <= face.vertexIds.length; offset += 1) {
    const index = (startIndex - offset + face.vertexIds.length) % face.vertexIds.length
    const id = face.vertexIds[index]!
    backward.push(id)
    if (id === end) break
  }
  return backward.at(-1) === end && backward.length > 2 ? backward : null
}

function dissolveEdge(
  topology: CustomMeshTopology,
  command: Extract<CustomMeshCommand, { type: 'dissolve-edge' }>,
): CustomMeshCommandResult {
  const edge = topology.edges.find((entry) => entry.id === command.edgeId)
  if (!edge) return { ok: false, error: `Edge not found: ${command.edgeId}` }
  const [a, b] = edge.vertexIds
  const adjacentFaces = topology.faces.filter((face) => faceContainsEdge(face, a, b))
  if (adjacentFaces.length !== 2) {
    return {
      ok: false,
      error: 'Dissolve requires an edge shared by exactly two faces',
    }
  }
  const firstPath = longFacePath(adjacentFaces[0]!, a, b)
  const secondPath = longFacePath(adjacentFaces[1]!, b, a)
  if (!(firstPath && secondPath))
    return { ok: false, error: 'Could not resolve adjacent face loops' }
  const mergedLoop = [...firstPath, ...secondPath.slice(1, -1)]
  if (new Set(mergedLoop).size !== mergedLoop.length) {
    return {
      ok: false,
      error: 'Dissolving this edge would create a repeated face vertex',
    }
  }
  const removedFaceId = adjacentFaces[1]!.id
  const nextTopology: CustomMeshTopology = {
    vertices: topology.vertices,
    edges: topology.edges.filter((entry) => entry.id !== edge.id),
    faces: topology.faces
      .filter((face) => face.id !== removedFaceId)
      .map((face) =>
        face.id === adjacentFaces[0]!.id ? { ...face, vertexIds: mergedLoop } : face,
      ),
  }
  const issues = inspectCustomMeshTopology(nextTopology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  return {
    ok: true,
    topology: nextTopology,
    selection: { mode: 'face', ids: [adjacentFaces[0]!.id] },
  }
}

export function applyCustomMeshCommand(
  topology: CustomMeshTopology,
  command: CustomMeshCommand,
): CustomMeshCommandResult {
  const issues = inspectCustomMeshTopology(topology)
  if (issues.length > 0) return { ok: false, error: issues[0]!.message }
  switch (command.type) {
    case 'extrude-face':
      return extrudeFace(topology, command)
    case 'translate-components':
      return translateComponents(topology, command)
    case 'rotate-components':
      return rotateComponents(topology, command)
    case 'scale-components':
      return scaleComponents(topology, command)
    case 'inset-face':
      return insetFace(topology, command)
    case 'delete-components':
      return deleteComponents(topology, command)
    case 'merge-vertices':
      return mergeVertices(topology, command)
    case 'dissolve-edge':
      return dissolveEdge(topology, command)
    case 'loop-cut':
      return loopCut(topology, command)
    case 'bevel-edge':
      return bevelEdge(topology, command)
  }
}
