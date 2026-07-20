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
    const candidates = labelShiftCandidates(rectangle, occupied)
    const selected = candidates.find(
      ({ dx, dy }) =>
        !occupied.some((other) =>
          rectanglesOverlap(
            { ...rectangle, x: rectangle.x + dx, y: rectangle.y + dy },
            { ...other, x: other.x + other.dx, y: other.y + other.dy },
          ),
        ),
    )
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
    svg.querySelectorAll<SVGGElement>('[data-floorplan-annotation-obstacle]'),
  ).map((obstacle) => {
    const bounds = obstacle.getBoundingClientRect()
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  })
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

function labelShiftCandidates(
  rectangle: AnnotationLabelRectangle,
  occupied: ReadonlyArray<AnnotationObstacleRectangle & { dx: number; dy: number }>,
) {
  const candidates = new Map<string, { dx: number; dy: number }>()
  const addCandidate = (dx: number, dy: number) => {
    candidates.set(`${dx}:${dy}`, { dx, dy })
  }
  addCandidate(0, 0)

  for (const other of occupied) {
    const otherX = other.x + other.dx
    const otherY = other.y + other.dy
    const left = otherX - LABEL_PLACEMENT_GAP_PX - rectangle.width - rectangle.x
    const right = otherX + other.width + LABEL_PLACEMENT_GAP_PX - rectangle.x
    const above = otherY - LABEL_PLACEMENT_GAP_PX - rectangle.height - rectangle.y
    const below = otherY + other.height + LABEL_PLACEMENT_GAP_PX - rectangle.y

    addCandidate(0, above)
    addCandidate(0, below)
    addCandidate(left, 0)
    addCandidate(right, 0)
    addCandidate(left, above)
    addCandidate(right, above)
    addCandidate(left, below)
    addCandidate(right, below)
  }

  return [...candidates.values()].sort(
    (left, right) => candidateCost(left, rectangle) - candidateCost(right, rectangle),
  )
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
