import type { FloorplanGeometry } from '@pascal-app/core'

export type AnnotationLabelRectangle = {
  id: string
  x: number
  y: number
  width: number
  height: number
  priority: number
  tangentX?: number
  tangentY?: number
}

export type AnnotationObstacleRectangle = Pick<
  AnnotationLabelRectangle,
  'x' | 'y' | 'width' | 'height'
>

export type AnnotationLabelShift = {
  id: string
  dx: number
  dy: number
  resolved: boolean
}

const LABEL_GAP_PX = 6
const LABEL_PLACEMENT_GAP_PX = LABEL_GAP_PX + 0.5
const OUTLINE_SAMPLE_SPACING_PX = 6
const OUTLINE_OBSTACLE_PADDING_PX = 1
const MAX_LABEL_SHIFT_CANDIDATES = 512

export function resolveAnnotationLabelRectangles(
  rectangles: readonly AnnotationLabelRectangle[],
  obstacles: readonly AnnotationObstacleRectangle[] = [],
): AnnotationLabelShift[] {
  const occupied: Array<AnnotationObstacleRectangle & { dx: number; dy: number }> = obstacles.map(
    (obstacle) => ({ ...obstacle, dx: 0, dy: 0 }),
  )
  const shifts = new Map<string, AnnotationLabelShift>()
  const ordered = rectangles
    .map((rectangle, order) => ({ order, rectangle }))
    .sort(
      (left, right) =>
        right.rectangle.priority - left.rectangle.priority || left.order - right.order,
    )

  for (const { rectangle } of ordered) {
    const selected = resolveLabelShift(rectangle, occupied)
    const shift = selected ?? { dx: 0, dy: 0 }
    const resolved = selected !== undefined
    occupied.push({ ...rectangle, ...shift })
    shifts.set(rectangle.id, { id: rectangle.id, ...shift, resolved })
  }

  return rectangles.map(
    (rectangle) => shifts.get(rectangle.id) ?? { id: rectangle.id, dx: 0, dy: 0, resolved: false },
  )
}

export function resolveSvgAnnotationCollisions(svg: SVGSVGElement): void {
  const labels = Array.from(svg.querySelectorAll<SVGGElement>('[data-floorplan-annotation-label]'))
  if (labels.length === 0) return

  for (const label of labels) {
    const defaultTransform = label.dataset.floorplanAnnotationDefaultTransform
    if (defaultTransform !== undefined) label.setAttribute('transform', defaultTransform)
    label.removeAttribute('data-floorplan-layout-unresolved')
  }

  const rectangles = labels.map((label, index) => {
    const bounds = label.getBoundingClientRect()
    const matrix = label.getScreenCTM()
    const tangentLength = matrix ? Math.hypot(matrix.a, matrix.b) : 0
    return {
      id: label.dataset.floorplanAnnotationId ?? `annotation-${index}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      priority: Number(label.dataset.floorplanAnnotationPriority ?? 0),
      tangentX: tangentLength > 1e-9 && matrix ? matrix.a / tangentLength : undefined,
      tangentY: tangentLength > 1e-9 && matrix ? matrix.b / tangentLength : undefined,
    }
  })
  const obstacles = Array.from(
    svg.querySelectorAll<SVGGraphicsElement>('[data-floorplan-annotation-obstacle]'),
  ).flatMap(svgAnnotationObstacleRectangles)
  const shifts = resolveAnnotationLabelRectangles(rectangles, obstacles)

  labels.forEach((label, index) => {
    const rectangle = rectangles[index]
    const shift = rectangle && shifts.find((candidate) => candidate.id === rectangle.id)
    if (!shift || (shift.dx === 0 && shift.dy === 0)) {
      if (shift && !shift.resolved) label.dataset.floorplanLayoutUnresolved = 'true'
      return
    }
    const matrix = label.getScreenCTM()
    if (!matrix) return
    const local = screenVectorToLocal(matrix, shift.dx, shift.dy)
    const defaultTransform = label.dataset.floorplanAnnotationDefaultTransform ?? ''
    label.setAttribute('transform', `${defaultTransform} translate(${local.x} ${local.y})`.trim())
    if (!shift.resolved) label.dataset.floorplanLayoutUnresolved = 'true'
  })
}

function svgAnnotationObstacleRectangles(
  obstacle: SVGGraphicsElement,
): AnnotationObstacleRectangle[] {
  const bounds = obstacle.getBoundingClientRect()
  const fallback = [{ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }]
  if (obstacle.getAttribute('data-floorplan-annotation-obstacle') !== 'outline') return fallback

  const geometry = obstacle as SVGGeometryElement
  const matrix = geometry.getScreenCTM()
  if (!matrix || typeof geometry.getTotalLength !== 'function') return fallback

  try {
    const length = geometry.getTotalLength()
    const screenScale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d))
    const sampleCount = Math.max(1, Math.ceil((length * screenScale) / OUTLINE_SAMPLE_SPACING_PX))
    const points = Array.from({ length: sampleCount + 1 }, (_, index) => {
      const point = geometry.getPointAtLength((length * index) / sampleCount)
      return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
      }
    })
    return polylineObstacleRectangles(points)
  } catch {
    return fallback
  }
}

export function polylineObstacleRectangles(
  points: readonly { x: number; y: number }[],
): AnnotationObstacleRectangle[] {
  if (points.length === 1) {
    const point = points[0]!
    return [
      {
        x: point.x - OUTLINE_OBSTACLE_PADDING_PX,
        y: point.y - OUTLINE_OBSTACLE_PADDING_PX,
        width: OUTLINE_OBSTACLE_PADDING_PX * 2,
        height: OUTLINE_OBSTACLE_PADDING_PX * 2,
      },
    ]
  }

  const rectangles: AnnotationObstacleRectangle[] = []
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!
    const end = points[index]!
    rectangles.push({
      x: Math.min(start.x, end.x) - OUTLINE_OBSTACLE_PADDING_PX,
      y: Math.min(start.y, end.y) - OUTLINE_OBSTACLE_PADDING_PX,
      width: Math.abs(end.x - start.x) + OUTLINE_OBSTACLE_PADDING_PX * 2,
      height: Math.abs(end.y - start.y) + OUTLINE_OBSTACLE_PADDING_PX * 2,
    })
  }
  return rectangles
}

function resolveLabelShift(
  rectangle: AnnotationLabelRectangle,
  occupied: ReadonlyArray<AnnotationObstacleRectangle & { dx: number; dy: number }>,
): { dx: number; dy: number } | undefined {
  const candidates = new Map<string, { dx: number; dy: number }>()
  const addCandidate = (dx: number, dy: number) => {
    candidates.set(`${dx}:${dy}`, { dx, dy })
  }
  addCandidate(0, 0)

  const visited = new Set<string>()
  while (candidates.size > 0 && visited.size < MAX_LABEL_SHIFT_CANDIDATES) {
    const candidate = [...candidates.values()].sort(
      (left, right) => candidateCost(left, rectangle) - candidateCost(right, rectangle),
    )[0]!
    const key = `${candidate.dx}:${candidate.dy}`
    candidates.delete(key)
    visited.add(key)

    const shifted = {
      ...rectangle,
      x: rectangle.x + candidate.dx,
      y: rectangle.y + candidate.dy,
    }
    const blockers = occupied.filter((other) =>
      rectanglesOverlap(shifted, {
        ...other,
        x: other.x + other.dx,
        y: other.y + other.dy,
      }),
    )
    if (blockers.length === 0) return candidate

    for (const other of blockers) {
      const otherX = other.x + other.dx
      const otherY = other.y + other.dy
      const left = otherX - LABEL_PLACEMENT_GAP_PX - rectangle.width - rectangle.x
      const right = otherX + other.width + LABEL_PLACEMENT_GAP_PX - rectangle.x
      const above = otherY - LABEL_PLACEMENT_GAP_PX - rectangle.height - rectangle.y
      const below = otherY + other.height + LABEL_PLACEMENT_GAP_PX - rectangle.y

      addCandidate(candidate.dx, above)
      addCandidate(candidate.dx, below)
      addCandidate(left, candidate.dy)
      addCandidate(right, candidate.dy)
      addCandidate(left, above)
      addCandidate(right, above)
      addCandidate(left, below)
      addCandidate(right, below)
    }

    for (const visitedKey of visited) candidates.delete(visitedKey)
  }
  return undefined
}

function candidateCost(
  candidate: { dx: number; dy: number },
  rectangle: AnnotationLabelRectangle,
): number {
  const distance = Math.hypot(candidate.dx, candidate.dy)
  if (rectangle.tangentX === undefined || rectangle.tangentY === undefined) return distance

  const perpendicularMovement = Math.abs(
    candidate.dx * -rectangle.tangentY + candidate.dy * rectangle.tangentX,
  )
  return distance + perpendicularMovement * 4
}

export function isFloorplanAnnotationObstacleGeometry(geometry: FloorplanGeometry): boolean {
  if (geometry.kind !== 'group') return false
  const hasPlate = geometry.children.some(
    (child) => child.kind === 'rect' || child.kind === 'circle',
  )
  const hasUprightText = geometry.children.some((child) => child.kind === 'text' && child.upright)
  return hasPlate && hasUprightText
}

function rectanglesOverlap(
  left: Pick<AnnotationLabelRectangle, 'x' | 'y' | 'width' | 'height'>,
  right: Pick<AnnotationLabelRectangle, 'x' | 'y' | 'width' | 'height'>,
): boolean {
  return !(
    left.x + left.width + LABEL_GAP_PX <= right.x ||
    right.x + right.width + LABEL_GAP_PX <= left.x ||
    left.y + left.height + LABEL_GAP_PX <= right.y ||
    right.y + right.height + LABEL_GAP_PX <= left.y
  )
}

function screenVectorToLocal(matrix: DOMMatrix, dx: number, dy: number) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(determinant) < 1e-9) return { x: 0, y: 0 }
  return {
    x: (matrix.d * dx - matrix.c * dy) / determinant,
    y: (-matrix.b * dx + matrix.a * dy) / determinant,
  }
}
