import type { FloorplanGeometry, FloorplanPoint } from '@pascal-app/core'
import { computeArchitecturalDimensionLayout } from './floorplan-dimension-renderer'
import { resolveFloorplanLabelAngle } from './floorplan-label-angle'

export type FloorplanDiagnosticSource = {
  ownerId: string
  ownerType: string
  base: FloorplanGeometry | null
  overlay: FloorplanGeometry | null
}

export type FloorplanAnnotationDiagnostic = {
  id: string
  kind: 'label-overlap' | 'plan-collision' | 'short-segment'
  label: string
  corners: readonly FloorplanPoint[]
}

type Transform = {
  translate: FloorplanPoint
  rotation: number
}

type LabelBox = {
  id: string
  ownerId: string
  label: string
  corners: readonly FloorplanPoint[]
  width: number
  measuredLength?: number
}

type Obstacle =
  | { kind: 'polygon'; ownerId: string; points: readonly FloorplanPoint[] }
  | { kind: 'segment'; ownerId: string; start: FloorplanPoint; end: FloorplanPoint }
  | { kind: 'circle'; ownerId: string; center: FloorplanPoint; radius: number }

const IDENTITY_TRANSFORM: Transform = { translate: [0, 0], rotation: 0 }
const ARCHITECTURAL_LABEL_FONT_SIZE = 0.15
const ARCHITECTURAL_CHARACTER_WIDTH = ARCHITECTURAL_LABEL_FONT_SIZE * 0.6
const SHORT_SEGMENT_END_CLEARANCE = 0.12

export function analyzeFloorplanAnnotationCollisions(
  sources: readonly FloorplanDiagnosticSource[],
  unitsPerPixel: number,
  sceneRotationDeg: number,
): FloorplanAnnotationDiagnostic[] {
  const labels: LabelBox[] = []
  const obstacles: Obstacle[] = []

  for (const source of sources) {
    if (source.base) collectObstacles(source.base, source.ownerId, IDENTITY_TRANSFORM, obstacles)
    if (source.overlay) {
      collectLabels(
        source.overlay,
        source.ownerId,
        IDENTITY_TRANSFORM,
        Math.max(unitsPerPixel, 1e-6),
        sceneRotationDeg,
        labels,
      )
    }
  }

  const diagnostics: FloorplanAnnotationDiagnostic[] = []
  for (const label of labels) {
    if (
      label.measuredLength !== undefined &&
      label.measuredLength < label.width + SHORT_SEGMENT_END_CLEARANCE
    ) {
      diagnostics.push(toDiagnostic(label, 'short-segment'))
    }
    if (
      obstacles.some(
        (obstacle) => obstacle.ownerId !== label.ownerId && boxIntersectsObstacle(label, obstacle),
      )
    ) {
      diagnostics.push(toDiagnostic(label, 'plan-collision'))
    }
  }

  for (let leftIndex = 0; leftIndex < labels.length; leftIndex++) {
    const left = labels[leftIndex]
    if (!left) continue
    for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex++) {
      const right = labels[rightIndex]
      if (!right || !convexPolygonsIntersect(left.corners, right.corners)) continue
      diagnostics.push(toDiagnostic(left, 'label-overlap'))
      diagnostics.push(toDiagnostic(right, 'label-overlap'))
    }
  }

  return deduplicateDiagnostics(diagnostics)
}

function collectLabels(
  geometry: FloorplanGeometry,
  ownerId: string,
  transform: Transform,
  unitsPerPixel: number,
  sceneRotationDeg: number,
  out: LabelBox[],
): void {
  if (geometry.kind === 'group') {
    const nested = composeTransform(transform, geometry.transform)
    for (const child of geometry.children) {
      collectLabels(child, ownerId, nested, unitsPerPixel, sceneRotationDeg, out)
    }
    return
  }

  if (geometry.kind === 'dimension') {
    const transformed = {
      ...geometry,
      start: applyPoint(transform, geometry.start),
      end: applyPoint(transform, geometry.end),
      dimensionStart: geometry.dimensionStart
        ? applyPoint(transform, geometry.dimensionStart)
        : undefined,
      dimensionEnd: geometry.dimensionEnd
        ? applyPoint(transform, geometry.dimensionEnd)
        : undefined,
      offsetNormal: rotatePoint(geometry.offsetNormal, transform.rotation),
    }
    const layout = computeArchitecturalDimensionLayout(transformed, sceneRotationDeg)
    if (!layout) return
    const width = Math.max(
      ARCHITECTURAL_LABEL_FONT_SIZE,
      geometry.text.length * ARCHITECTURAL_CHARACTER_WIDTH,
    )
    out.push({
      id: `${ownerId}:dimension:${out.length}`,
      ownerId,
      label: geometry.text,
      corners: orientedBox(
        layout.labelPoint,
        width,
        ARCHITECTURAL_LABEL_FONT_SIZE * 1.25,
        (layout.labelAngleDeg * Math.PI) / 180,
        ARCHITECTURAL_LABEL_FONT_SIZE * 0.8,
      ),
      width,
      measuredLength: distance(layout.dimensionStart, layout.dimensionEnd),
    })
    return
  }

  if (geometry.kind !== 'dimension-label') return
  const anchor = applyPoint(transform, [geometry.cx, geometry.cy])
  const localAngle = geometry.angle + transform.rotation
  const angleDeg = resolveFloorplanLabelAngle(localAngle, sceneRotationDeg, geometry.screenUpright)
  const angle = (angleDeg * Math.PI) / 180
  const outlined = geometry.appearance === 'outlined'
  const fontSize = unitsPerPixel * (outlined ? 12 : 10)
  const width = geometry.text.length * unitsPerPixel * 6.2 + (outlined ? 0 : unitsPerPixel * 12)
  const height = fontSize + (outlined ? 0 : unitsPerPixel * 6)
  const offset = rotatePoint([0, -(geometry.offsetPx ?? 0) * unitsPerPixel], angle)
  const center: FloorplanPoint = [anchor[0] + offset[0], anchor[1] + offset[1]]
  out.push({
    id: `${ownerId}:dimension-label:${out.length}`,
    ownerId,
    label: geometry.text,
    corners: orientedBox(center, width, height, angle),
    width,
  })
}

function collectObstacles(
  geometry: FloorplanGeometry,
  ownerId: string,
  transform: Transform,
  out: Obstacle[],
): void {
  if (geometry.kind === 'group') {
    const nested = composeTransform(transform, geometry.transform)
    for (const child of geometry.children) collectObstacles(child, ownerId, nested, out)
    return
  }
  if (geometry.kind === 'polygon') {
    out.push({
      kind: 'polygon',
      ownerId,
      points: geometry.points.map((point) => applyPoint(transform, point)),
    })
    return
  }
  if (geometry.kind === 'rect') {
    const points: FloorplanPoint[] = [
      [geometry.x, geometry.y],
      [geometry.x + geometry.width, geometry.y],
      [geometry.x + geometry.width, geometry.y + geometry.height],
      [geometry.x, geometry.y + geometry.height],
    ]
    out.push({
      kind: 'polygon',
      ownerId,
      points: points.map((point) => applyPoint(transform, point)),
    })
    return
  }
  if (geometry.kind === 'line') {
    out.push({
      kind: 'segment',
      ownerId,
      start: applyPoint(transform, [geometry.x1, geometry.y1]),
      end: applyPoint(transform, [geometry.x2, geometry.y2]),
    })
    return
  }
  if (geometry.kind === 'polyline') {
    for (let index = 0; index < geometry.points.length - 1; index++) {
      const start = geometry.points[index]
      const end = geometry.points[index + 1]
      if (!start || !end) continue
      out.push({
        kind: 'segment',
        ownerId,
        start: applyPoint(transform, start),
        end: applyPoint(transform, end),
      })
    }
    return
  }
  if (geometry.kind === 'circle') {
    out.push({
      kind: 'circle',
      ownerId,
      center: applyPoint(transform, [geometry.cx, geometry.cy]),
      radius: geometry.r,
    })
  }
}

function composeTransform(
  parent: Transform,
  child?: { translate?: FloorplanPoint; rotate?: number },
): Transform {
  if (!child) return parent
  const translated = child.translate
    ? rotatePoint(child.translate, parent.rotation)
    : ([0, 0] as const)
  return {
    translate: [parent.translate[0] + translated[0], parent.translate[1] + translated[1]],
    rotation: parent.rotation + (child.rotate ?? 0),
  }
}

function applyPoint(transform: Transform, point: FloorplanPoint): FloorplanPoint {
  const rotated = rotatePoint(point, transform.rotation)
  return [rotated[0] + transform.translate[0], rotated[1] + transform.translate[1]]
}

function rotatePoint(point: FloorplanPoint, angle: number): FloorplanPoint {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [point[0] * cosine - point[1] * sine, point[0] * sine + point[1] * cosine]
}

function orientedBox(
  center: FloorplanPoint,
  width: number,
  height: number,
  angle: number,
  offsetY = 0,
): readonly FloorplanPoint[] {
  const halfWidth = width / 2
  const halfHeight = height / 2
  const corners: FloorplanPoint[] = [
    [-halfWidth, -halfHeight - offsetY],
    [halfWidth, -halfHeight - offsetY],
    [halfWidth, halfHeight - offsetY],
    [-halfWidth, halfHeight - offsetY],
  ]
  return corners.map((point) => {
    const rotated = rotatePoint(point, angle)
    return [center[0] + rotated[0], center[1] + rotated[1]] as FloorplanPoint
  })
}

function boxIntersectsObstacle(box: LabelBox, obstacle: Obstacle): boolean {
  if (obstacle.kind === 'polygon') return convexPolygonsIntersect(box.corners, obstacle.points)
  if (obstacle.kind === 'segment')
    return segmentIntersectsPolygon(obstacle.start, obstacle.end, box.corners)
  return (
    pointInPolygon(obstacle.center, box.corners) ||
    polygonEdges(box.corners).some(
      ([start, end]) => pointSegmentDistance(obstacle.center, start, end) <= obstacle.radius,
    )
  )
}

function convexPolygonsIntersect(
  left: readonly FloorplanPoint[],
  right: readonly FloorplanPoint[],
): boolean {
  if (left.length < 3 || right.length < 3) return false
  return ![left, right].some((polygon) =>
    polygonEdges(polygon).some(([start, end]) => {
      const axis: FloorplanPoint = [-(end[1] - start[1]), end[0] - start[0]]
      const leftProjection = projectPolygon(left, axis)
      const rightProjection = projectPolygon(right, axis)
      return leftProjection.max < rightProjection.min || rightProjection.max < leftProjection.min
    }),
  )
}

function projectPolygon(points: readonly FloorplanPoint[], axis: FloorplanPoint) {
  const values = points.map((point) => point[0] * axis[0] + point[1] * axis[1])
  return { min: Math.min(...values), max: Math.max(...values) }
}

function segmentIntersectsPolygon(
  start: FloorplanPoint,
  end: FloorplanPoint,
  polygon: readonly FloorplanPoint[],
): boolean {
  return (
    pointInPolygon(start, polygon) ||
    pointInPolygon(end, polygon) ||
    polygonEdges(polygon).some(([edgeStart, edgeEnd]) =>
      segmentsIntersect(start, end, edgeStart, edgeEnd),
    )
  )
}

function pointInPolygon(point: FloorplanPoint, polygon: readonly FloorplanPoint[]): boolean {
  let inside = false
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const a = polygon[current]
    const b = polygon[previous]
    if (!a || !b) continue
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

function segmentsIntersect(
  aStart: FloorplanPoint,
  aEnd: FloorplanPoint,
  bStart: FloorplanPoint,
  bEnd: FloorplanPoint,
): boolean {
  const orientation = (a: FloorplanPoint, b: FloorplanPoint, c: FloorplanPoint) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const first = orientation(aStart, aEnd, bStart)
  const second = orientation(aStart, aEnd, bEnd)
  const third = orientation(bStart, bEnd, aStart)
  const fourth = orientation(bStart, bEnd, aEnd)
  return first * second <= 0 && third * fourth <= 0
}

function polygonEdges(points: readonly FloorplanPoint[]): Array<[FloorplanPoint, FloorplanPoint]> {
  return points.flatMap((point, index) => {
    const next = points[(index + 1) % points.length]
    return next ? [[point, next]] : []
  })
}

function pointSegmentDistance(
  point: FloorplanPoint,
  start: FloorplanPoint,
  end: FloorplanPoint,
): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-12) return distance(point, start)
  const along = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  )
  return Math.hypot(point[0] - (start[0] + along * dx), point[1] - (start[1] + along * dy))
}

function distance(left: FloorplanPoint, right: FloorplanPoint): number {
  return Math.hypot(right[0] - left[0], right[1] - left[1])
}

function toDiagnostic(
  label: LabelBox,
  kind: FloorplanAnnotationDiagnostic['kind'],
): FloorplanAnnotationDiagnostic {
  return { id: `${kind}:${label.id}`, kind, label: label.label, corners: label.corners }
}

function deduplicateDiagnostics(
  diagnostics: readonly FloorplanAnnotationDiagnostic[],
): FloorplanAnnotationDiagnostic[] {
  return Array.from(new Map(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic])).values())
}
