import type { BlockTopology } from '@pascal-app/core'
import {
  type Camera,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Triangle,
  Vector3,
} from 'three'
import { type BlockSelection, blockSelectionVertexIds } from './commands'
import { triangulateBlockFace } from './geometry'
import type { BlockTransformConstraint } from './modal-transform'

type Point = [number, number, number]

export type BlockGeometrySnap = {
  delta: Point
  kind: 'vertex' | 'edge' | 'face'
  source: Point
  target: Point
  targetId: string
}

export function blockGeometrySnapThreshold(
  camera: Camera,
  worldPoint: Vector3,
  viewportHeight: number,
  worldScale: Vector3,
  radiusPixels = 18,
): number {
  let worldUnitsPerPixel = 0
  if (camera instanceof PerspectiveCamera) {
    const cameraDepth = Math.abs(worldPoint.clone().applyMatrix4(camera.matrixWorldInverse).z)
    worldUnitsPerPixel =
      (2 * cameraDepth * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV() * 0.5))) /
      Math.max(viewportHeight, 1)
  } else if (camera instanceof OrthographicCamera) {
    worldUnitsPerPixel = (camera.top - camera.bottom) / Math.max(camera.zoom * viewportHeight, 1)
  }
  const largestWorldScale = Math.max(
    Math.abs(worldScale.x),
    Math.abs(worldScale.y),
    Math.abs(worldScale.z),
    1e-6,
  )
  return (worldUnitsPerPixel * radiusPixels) / largestWorldScale
}

function centroid(points: readonly Point[]): Point | null {
  if (points.length === 0) return null
  const total = points.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]] as Point,
    [0, 0, 0] as Point,
  )
  return total.map((value) => value / points.length) as Point
}

function closestPointOnSegment(point: Point, start: Point, end: Point): Point {
  const segment = new Vector3(...end).sub(new Vector3(...start))
  const lengthSquared = segment.lengthSq()
  if (lengthSquared < 1e-12) return [...start]
  const factor = Math.min(
    1,
    Math.max(0, new Vector3(...point).sub(new Vector3(...start)).dot(segment) / lengthSquared),
  )
  return new Vector3(...start).addScaledVector(segment, factor).toArray() as Point
}

function constrainedCorrection(correction: Point, constraint: BlockTransformConstraint): Point {
  if (constraint === 'free' || constraint === 'uniform') return correction
  return correction.map((value, index) => {
    const axis = index === 0 ? 'x' : index === 1 ? 'y' : 'z'
    return constraint.includes(axis) ? value : 0
  }) as Point
}

export function resolveBlockGeometrySnap(
  topology: BlockTopology,
  selection: BlockSelection & { activeId?: string | null },
  proposedDelta: Point,
  constraint: BlockTransformConstraint,
  threshold: number,
): BlockGeometrySnap | null {
  if (!(threshold > 0)) return null
  const vertexById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const selectedVertexIds = blockSelectionVertexIds(topology, selection)
  const selectedPoints = [...selectedVertexIds]
    .map((id) => vertexById.get(id))
    .filter((point): point is Point => Boolean(point))
  if (selectedPoints.length === 0) return null

  const sources: Point[] = []
  if (selection.activeId) {
    if (selection.mode === 'vertex') {
      const point = vertexById.get(selection.activeId)
      if (point) sources.push(point)
    } else if (selection.mode === 'edge') {
      const edge = topology.edges.find((entry) => entry.id === selection.activeId)
      const points = edge?.vertexIds
        .map((id) => vertexById.get(id))
        .filter((point): point is Point => Boolean(point))
      const point = points ? centroid(points) : null
      if (point) sources.push(point)
    } else {
      const face = topology.faces.find((entry) => entry.id === selection.activeId)
      const points = face?.vertexIds
        .map((id) => vertexById.get(id))
        .filter((point): point is Point => Boolean(point))
      const point = points ? centroid(points) : null
      if (point) sources.push(point)
    }
  }
  sources.push(...selectedPoints)
  const selectionCenter = centroid(selectedPoints)
  if (selectionCenter) sources.push(selectionCenter)

  let best: (BlockGeometrySnap & { distance: number }) | null = null
  const consider = (
    source: Point,
    target: Point,
    kind: BlockGeometrySnap['kind'],
    targetId: string,
  ) => {
    const movedSource = source.map((value, index) => value + proposedDelta[index]!) as Point
    const correction = target.map((value, index) => value - movedSource[index]!) as Point
    if (Math.hypot(...correction) > threshold) return
    const allowedCorrection = constrainedCorrection(correction, constraint)
    const distance = Math.hypot(...allowedCorrection)
    if (distance <= 1e-8 || (best && distance >= best.distance)) return
    best = {
      delta: proposedDelta.map((value, index) => value + allowedCorrection[index]!) as Point,
      distance,
      kind,
      source,
      target,
      targetId,
    }
  }

  for (const source of sources) {
    const movedSource = source.map((value, index) => value + proposedDelta[index]!) as Point
    for (const vertex of topology.vertices) {
      if (!selectedVertexIds.has(vertex.id)) consider(source, vertex.position, 'vertex', vertex.id)
    }
    for (const edge of topology.edges) {
      if (edge.vertexIds.some((id) => selectedVertexIds.has(id))) continue
      const start = vertexById.get(edge.vertexIds[0])
      const end = vertexById.get(edge.vertexIds[1])
      if (start && end) {
        consider(source, closestPointOnSegment(movedSource, start, end), 'edge', edge.id)
      }
    }
    for (const face of topology.faces) {
      if (face.vertexIds.some((id) => selectedVertexIds.has(id))) continue
      const triangulated = triangulateBlockFace(topology, face)
      if (!triangulated) continue
      for (const points of triangulated.triangles) {
        const triangle = new Triangle(
          new Vector3(...points[0]),
          new Vector3(...points[1]),
          new Vector3(...points[2]),
        )
        const target = triangle.closestPointToPoint(new Vector3(...movedSource), new Vector3())
        consider(source, target.toArray() as Point, 'face', face.id)
      }
    }
  }

  if (!best) return null
  const resolved = best as BlockGeometrySnap & { distance: number }
  return {
    delta: resolved.delta,
    kind: resolved.kind,
    source: resolved.source,
    target: resolved.target,
    targetId: resolved.targetId,
  }
}
