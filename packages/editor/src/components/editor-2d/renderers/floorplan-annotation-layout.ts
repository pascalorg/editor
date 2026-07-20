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
  preferredShifts?: readonly { dx: number; dy: number }[]
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
const PREFERRED_SHIFT_COST_STEP = 1_000_000

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
  resetDimensionConnectors(svg)

  const rectangles = labels.map((label, index) => {
    const bounds = label.getBoundingClientRect()
    const matrix = label.getScreenCTM()
    const tangentLength = matrix ? Math.hypot(matrix.a, matrix.b) : 0
    const outsideStartLocalX = Number(
      label.dataset.floorplanDimensionOutsideStartLocalX ?? Number.NaN,
    )
    const outsideStartLocalY = Number(
      label.dataset.floorplanDimensionOutsideStartLocalY ?? Number.NaN,
    )
    const preferredShifts =
      matrix && Number.isFinite(outsideStartLocalX) && Number.isFinite(outsideStartLocalY)
        ? [
            {
              dx: matrix.a * outsideStartLocalX + matrix.c * outsideStartLocalY,
              dy: matrix.b * outsideStartLocalX + matrix.d * outsideStartLocalY,
            },
          ]
        : undefined
    return {
      id: label.dataset.floorplanAnnotationId ?? `annotation-${index}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      priority: Number(label.dataset.floorplanAnnotationPriority ?? 0),
      tangentX: tangentLength > 1e-9 && matrix ? matrix.a / tangentLength : undefined,
      tangentY: tangentLength > 1e-9 && matrix ? matrix.b / tangentLength : undefined,
      preferredShifts,
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
    const preferredShift = rectangle.preferredShifts?.[0]
    const usedOutsideStart =
      preferredShift !== undefined &&
      Math.hypot(shift.dx - preferredShift.dx, shift.dy - preferredShift.dy) < 0.5
    if (usedOutsideStart) applyOutsideStartDimensionLine(label)
    else if (label.dataset.floorplanDimensionLabelPlacement === 'outside-end') {
      showDimensionLeader(label, matrix, shift.dx, shift.dy)
    }
    if (!shift.resolved) label.dataset.floorplanLayoutUnresolved = 'true'
  })
}

function resetDimensionConnectors(svg: SVGSVGElement): void {
  for (const line of svg.querySelectorAll<SVGLineElement>('[data-floorplan-dimension-line]')) {
    line.setAttribute(
      'x1',
      line.dataset.floorplanDimensionDefaultX1 ?? line.getAttribute('x1') ?? '0',
    )
    line.setAttribute(
      'y1',
      line.dataset.floorplanDimensionDefaultY1 ?? line.getAttribute('y1') ?? '0',
    )
    line.setAttribute(
      'x2',
      line.dataset.floorplanDimensionDefaultX2 ?? line.getAttribute('x2') ?? '0',
    )
    line.setAttribute(
      'y2',
      line.dataset.floorplanDimensionDefaultY2 ?? line.getAttribute('y2') ?? '0',
    )
  }
  for (const leader of svg.querySelectorAll<SVGLineElement>('[data-floorplan-dimension-leader]')) {
    leader.setAttribute('visibility', 'hidden')
  }
}

function applyOutsideStartDimensionLine(label: SVGGElement): void {
  const dimension = label.closest('[data-floorplan-dimension]')
  const line = dimension?.querySelector<SVGLineElement>('[data-floorplan-dimension-line]')
  if (!line) return
  const { dataset } = line
  if (
    dataset.floorplanDimensionOutsideStartX1 === undefined ||
    dataset.floorplanDimensionOutsideStartY1 === undefined ||
    dataset.floorplanDimensionOutsideStartX2 === undefined ||
    dataset.floorplanDimensionOutsideStartY2 === undefined
  ) {
    return
  }
  line.setAttribute('x1', dataset.floorplanDimensionOutsideStartX1)
  line.setAttribute('y1', dataset.floorplanDimensionOutsideStartY1)
  line.setAttribute('x2', dataset.floorplanDimensionOutsideStartX2)
  line.setAttribute('y2', dataset.floorplanDimensionOutsideStartY2)
}

function showDimensionLeader(
  label: SVGGElement,
  labelMatrix: DOMMatrix,
  dx: number,
  dy: number,
): void {
  const dimension = label.closest('[data-floorplan-dimension]') as SVGGElement | null
  const leader = dimension?.querySelector<SVGLineElement>('[data-floorplan-dimension-leader]')
  const dimensionLine = dimension?.querySelector<SVGLineElement>('[data-floorplan-dimension-line]')
  const dimensionMatrix = dimension?.getScreenCTM()
  if (!leader || !dimensionLine || !dimensionMatrix) return

  const start = dimensionEndpoint(label, 'start')
  const end = dimensionEndpoint(label, 'end')
  if (!start || !end) return
  dimensionLine.setAttribute('x1', String(start.x))
  dimensionLine.setAttribute('y1', String(start.y))
  dimensionLine.setAttribute('x2', String(end.x))
  dimensionLine.setAttribute('y2', String(end.y))
  const labelScreen = { x: labelMatrix.e + dx, y: labelMatrix.f + dy }
  const startScreen = localPointToScreen(dimensionMatrix, start.x, start.y)
  const endScreen = localPointToScreen(dimensionMatrix, end.x, end.y)
  const anchor =
    Math.hypot(labelScreen.x - startScreen.x, labelScreen.y - startScreen.y) <
    Math.hypot(labelScreen.x - endScreen.x, labelScreen.y - endScreen.y)
      ? start
      : end
  const labelPoint = screenPointToLocal(dimensionMatrix, labelScreen.x, labelScreen.y)

  leader.setAttribute('x1', String(anchor.x))
  leader.setAttribute('y1', String(anchor.y))
  leader.setAttribute('x2', String(labelPoint.x))
  leader.setAttribute('y2', String(labelPoint.y))
  leader.setAttribute('visibility', 'visible')
}

function dimensionEndpoint(
  label: SVGGElement,
  endpoint: 'start' | 'end',
): { x: number; y: number } | null {
  const x = Number(label.dataset[`floorplanDimension${endpoint === 'start' ? 'Start' : 'End'}X`])
  const y = Number(label.dataset[`floorplanDimension${endpoint === 'start' ? 'Start' : 'End'}Y`])
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function localPointToScreen(matrix: DOMMatrix, x: number, y: number) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

function screenPointToLocal(matrix: DOMMatrix, x: number, y: number) {
  const local = screenVectorToLocal(matrix, x - matrix.e, y - matrix.f)
  return { x: local.x, y: local.y }
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
  const candidates = new Map<string, { dx: number; dy: number; preference: number }>()
  const addCandidate = (dx: number, dy: number, preference = 0) => {
    const key = `${dx}:${dy}`
    const existing = candidates.get(key)
    if (!existing || preference < existing.preference) {
      candidates.set(key, { dx, dy, preference })
    }
  }
  addCandidate(0, 0, -2)
  for (const preferred of rectangle.preferredShifts ?? []) {
    addCandidate(preferred.dx, preferred.dy, -1)
  }

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
    if (blockers.length === 0) return { dx: candidate.dx, dy: candidate.dy }

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
  candidate: { dx: number; dy: number; preference?: number },
  rectangle: AnnotationLabelRectangle,
): number {
  const distance = Math.hypot(candidate.dx, candidate.dy)
  const preference = (candidate.preference ?? 0) * PREFERRED_SHIFT_COST_STEP
  if (rectangle.tangentX === undefined || rectangle.tangentY === undefined) {
    return preference + distance
  }

  const perpendicularMovement = Math.abs(
    candidate.dx * -rectangle.tangentY + candidate.dy * rectangle.tangentX,
  )
  return preference + distance + perpendicularMovement * 4
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
