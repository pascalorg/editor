import type { FloorplanGeometry } from '@pascal-app/core'
import { readFloorplanGeometryMetadata } from '../../../lib/floorplan/floorplan-extension'

export type AnnotationLabelRectangle = {
  id: string
  x: number
  y: number
  width: number
  height: number
  priority: number
  text?: string
  labelPlacement?: 'inside' | 'outside-end'
  pinnedShift?: { dx: number; dy: number }
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
const COLLISION_GRID_CELL_SIZE_PX = 64

class AnnotationObstacleIndex {
  private readonly cells = new Map<string, Set<AnnotationObstacleRectangle>>()

  add(rectangle: AnnotationObstacleRectangle): void {
    this.forEachCell(rectangle, 0, (key) => {
      let cell = this.cells.get(key)
      if (!cell) {
        cell = new Set()
        this.cells.set(key, cell)
      }
      cell.add(rectangle)
    })
  }

  findOverlaps(rectangle: AnnotationObstacleRectangle): AnnotationObstacleRectangle[] {
    const candidates = new Set<AnnotationObstacleRectangle>()
    this.forEachCell(rectangle, LABEL_GAP_PX, (key) => {
      for (const candidate of this.cells.get(key) ?? []) candidates.add(candidate)
    })
    return [...candidates].filter((candidate) => rectanglesOverlap(rectangle, candidate))
  }

  private forEachCell(
    rectangle: AnnotationObstacleRectangle,
    padding: number,
    visit: (key: string) => void,
  ): void {
    const minCellX = Math.floor((rectangle.x - padding) / COLLISION_GRID_CELL_SIZE_PX)
    const maxCellX = Math.floor(
      (rectangle.x + rectangle.width + padding) / COLLISION_GRID_CELL_SIZE_PX,
    )
    const minCellY = Math.floor((rectangle.y - padding) / COLLISION_GRID_CELL_SIZE_PX)
    const maxCellY = Math.floor(
      (rectangle.y + rectangle.height + padding) / COLLISION_GRID_CELL_SIZE_PX,
    )
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) visit(`${cellX}:${cellY}`)
    }
  }
}

export type AnnotationLayoutOverride = { dx: number; dy: number; pinned?: boolean }
export type AnnotationLayoutOverrides = Readonly<Record<string, AnnotationLayoutOverride>>
export type AnnotationPreflightIssueKind =
  | 'unresolved-collision'
  | 'short-unreadable-segment'
  | 'plan-geometry-conflict'
export type AnnotationPreflightIssue = {
  id: string
  kind: AnnotationPreflightIssueKind
  severity: 'warning'
  message: string
}

export function resolveAnnotationLabelRectangles(
  rectangles: readonly AnnotationLabelRectangle[],
  obstacles: readonly AnnotationObstacleRectangle[] = [],
): AnnotationLabelShift[] {
  const occupied = new AnnotationObstacleIndex()
  for (const obstacle of obstacles) occupied.add(obstacle)
  const shifts = new Map<string, AnnotationLabelShift>()
  const ordered = rectangles
    .map((rectangle, order) => ({ order, rectangle }))
    .sort(
      (left, right) =>
        Number(Boolean(right.rectangle.pinnedShift)) -
          Number(Boolean(left.rectangle.pinnedShift)) ||
        right.rectangle.priority - left.rectangle.priority ||
        left.order - right.order,
    )

  for (const { rectangle } of ordered) {
    const selected = rectangle.pinnedShift ?? resolveLabelShift(rectangle, occupied)
    const shift = selected ?? { dx: 0, dy: 0 }
    const resolved = rectangle.pinnedShift !== undefined || selected !== undefined
    occupied.add({
      x: rectangle.x + shift.dx,
      y: rectangle.y + shift.dy,
      width: rectangle.width,
      height: rectangle.height,
    })
    shifts.set(rectangle.id, { id: rectangle.id, ...shift, resolved })
  }

  return rectangles.map(
    (rectangle) => shifts.get(rectangle.id) ?? { id: rectangle.id, dx: 0, dy: 0, resolved: false },
  )
}

export function resolveSvgAnnotationCollisions(
  svg: SVGSVGElement,
  options: { layoutOverrides?: AnnotationLayoutOverrides } = {},
): AnnotationPreflightIssue[] {
  const labels = Array.from(svg.querySelectorAll<SVGGElement>('[data-floorplan-annotation-label]'))
  if (labels.length === 0) return []

  for (const label of labels) {
    const defaultTransform = label.dataset.floorplanAnnotationDefaultTransform
    if (defaultTransform !== undefined) label.setAttribute('transform', defaultTransform)
    label.removeAttribute('data-floorplan-layout-unresolved')
    delete label.dataset.floorplanAnnotationLayoutDx
    delete label.dataset.floorplanAnnotationLayoutDy
  }
  resetDimensionConnectors(svg)

  const pinnedLocalById = new Map<string, { x: number; y: number }>()
  const rectangles: AnnotationLabelRectangle[] = labels.map((label, index) => {
    const bounds = label.getBoundingClientRect()
    const matrix = label.getScreenCTM()
    const id = svgAnnotationLabelId(label, index)
    label.dataset.floorplanAnnotationId = id
    const override = options.layoutOverrides?.[id]
    const pinnedLocal =
      override?.pinned === true && Number.isFinite(override.dx) && Number.isFinite(override.dy)
        ? { dx: override.dx, dy: override.dy }
        : undefined
    if (pinnedLocal) pinnedLocalById.set(id, { x: pinnedLocal.dx, y: pinnedLocal.dy })
    const pinnedShift =
      pinnedLocal && matrix
        ? {
            dx: matrix.a * pinnedLocal.dx + matrix.c * pinnedLocal.dy,
            dy: matrix.b * pinnedLocal.dx + matrix.d * pinnedLocal.dy,
          }
        : undefined
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
      id,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      priority: Number(label.dataset.floorplanAnnotationPriority ?? 0),
      text: label.textContent?.trim() ?? '',
      labelPlacement:
        label.dataset.floorplanDimensionLabelPlacement === 'outside-end' ? 'outside-end' : 'inside',
      pinnedShift,
      tangentX: tangentLength > 1e-9 && matrix ? matrix.a / tangentLength : undefined,
      tangentY: tangentLength > 1e-9 && matrix ? matrix.b / tangentLength : undefined,
      preferredShifts,
    }
  })
  const obstacles = Array.from(
    svg.querySelectorAll<SVGGraphicsElement>('[data-floorplan-annotation-obstacle]'),
  ).flatMap(svgAnnotationObstacleRectangles)
  const shifts = resolveAnnotationLabelRectangles(rectangles, obstacles)
  const preflightIssues = collectAnnotationLayoutPreflightIssues(rectangles, shifts, obstacles)

  labels.forEach((label, index) => {
    const rectangle = rectangles[index]
    const shift = rectangle && shifts.find((candidate) => candidate.id === rectangle.id)
    if (!shift || (shift.dx === 0 && shift.dy === 0)) {
      label.dataset.floorplanAnnotationLayoutDx = '0'
      label.dataset.floorplanAnnotationLayoutDy = '0'
      if (shift && !shift.resolved) label.dataset.floorplanLayoutUnresolved = 'true'
      return
    }
    const matrix = label.getScreenCTM()
    if (!matrix) return
    const local = pinnedLocalById.get(shift.id) ?? screenVectorToLocal(matrix, shift.dx, shift.dy)
    label.dataset.floorplanAnnotationLayoutDx = String(local.x)
    label.dataset.floorplanAnnotationLayoutDy = String(local.y)
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
  return preflightIssues
}

export function observeSvgAnnotationLayoutChanges(target: Node, onChange: () => void): () => void {
  let scheduledFrame: number | null = null
  let mutationVersion = 0
  let observedVersion = 0
  const requestFrame = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0))
  const flushWhenSettled = () => {
    if (observedVersion !== mutationVersion) {
      observedVersion = mutationVersion
      scheduledFrame = requestFrame(flushWhenSettled)
      return
    }
    scheduledFrame = null
    onChange()
  }
  const schedule = () => {
    mutationVersion += 1
    if (scheduledFrame !== null) return
    observedVersion = mutationVersion - 1
    scheduledFrame = requestFrame(flushWhenSettled)
  }
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(isAnnotationLayoutMutation)) schedule()
  })
  observer.observe(target, {
    attributes: true,
    attributeFilter: [
      'cx',
      'cy',
      'd',
      'dominant-baseline',
      'font-family',
      'font-size',
      'font-weight',
      'height',
      'points',
      'r',
      'rx',
      'ry',
      'stroke-width',
      'text-anchor',
      'transform',
      'visibility',
      'width',
      'x',
      'x1',
      'x2',
      'y',
      'y1',
      'y2',
    ],
    characterData: true,
    childList: true,
    subtree: true,
  })
  return () => {
    observer.disconnect()
    if (scheduledFrame === null) return
    if (globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(scheduledFrame)
    else clearTimeout(scheduledFrame)
  }
}

function isAnnotationLayoutMutation(mutation: MutationRecord): boolean {
  if (mutation.type !== 'attributes') return true
  const attribute = mutation.attributeName ?? ''
  const target = mutation.target as Element
  const closest = typeof target.closest === 'function' ? target.closest.bind(target) : null

  if (
    attribute === 'data-floorplan-annotation-id' ||
    attribute === 'data-floorplan-annotation-layout-dx' ||
    attribute === 'data-floorplan-annotation-layout-dy' ||
    attribute === 'data-floorplan-layout-unresolved'
  ) {
    return false
  }
  if (
    closest?.('[data-floorplan-annotation-label]') &&
    (attribute === 'style' || attribute === 'transform')
  ) {
    return false
  }
  if (
    closest?.('[data-floorplan-dimension-line], [data-floorplan-dimension-leader]') &&
    (attribute === 'x1' ||
      attribute === 'x2' ||
      attribute === 'y1' ||
      attribute === 'y2' ||
      attribute === 'visibility')
  ) {
    return false
  }
  return true
}

export function collectAnnotationLayoutPreflightIssues(
  rectangles: readonly AnnotationLabelRectangle[],
  shifts: readonly AnnotationLabelShift[],
  obstacles: readonly AnnotationObstacleRectangle[] = [],
): AnnotationPreflightIssue[] {
  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]))
  const finalRectangles = rectangles.map((rectangle) => {
    const shift = shiftsById.get(rectangle.id) ?? {
      id: rectangle.id,
      dx: 0,
      dy: 0,
      resolved: false,
    }
    return {
      source: rectangle,
      shift,
      bounds: {
        x: rectangle.x + shift.dx,
        y: rectangle.y + shift.dy,
        width: rectangle.width,
        height: rectangle.height,
      },
    }
  })
  const issues: AnnotationPreflightIssue[] = []
  const addIssue = (id: string, kind: AnnotationPreflightIssueKind, message: string): void => {
    if (issues.some((issue) => issue.id === id && issue.kind === kind)) return
    issues.push({ id, kind, severity: 'warning', message })
  }

  for (const entry of finalRectangles) {
    const label = preflightLabel(entry.source)
    if (entry.source.labelPlacement === 'outside-end') {
      addIssue(
        entry.source.id,
        'short-unreadable-segment',
        `${label} is too short for inline text and uses an outside label or leader.`,
      )
    }
    if (obstacles.some((obstacle) => rectanglesOverlap(entry.bounds, obstacle))) {
      addIssue(
        entry.source.id,
        'plan-geometry-conflict',
        `${label} still conflicts with fixed plan geometry after automatic layout.`,
      )
    }
    if (!entry.shift.resolved) {
      const collidesWithLabel = finalRectangles.some(
        (candidate) =>
          candidate.source.id !== entry.source.id &&
          rectanglesOverlap(entry.bounds, candidate.bounds),
      )
      if (collidesWithLabel) {
        addIssue(
          entry.source.id,
          'unresolved-collision',
          `${label} still overlaps another annotation after automatic layout.`,
        )
      }
    }
  }
  return issues
}

function preflightLabel(rectangle: AnnotationLabelRectangle): string {
  const text = rectangle.text?.trim()
  return text ? `Annotation "${text}"` : `Annotation ${rectangle.id}`
}

export function svgAnnotationLabelId(label: SVGGElement, index: number): string {
  const explicit = label.dataset.floorplanAnnotationId?.trim()
  if (explicit) return explicit
  const defaultTransform = label.dataset.floorplanAnnotationDefaultTransform ?? ''
  const text = label.textContent?.trim() ?? ''
  return `annotation:${index}:${text}:${defaultTransform}`
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
  occupied: AnnotationObstacleIndex,
): { dx: number; dy: number } | undefined {
  const candidates = new Map<string, { dx: number; dy: number; preference: number; cost: number }>()
  const visited = new Set<string>()
  const addCandidate = (dx: number, dy: number, preference = 0) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    const key = `${dx}:${dy}`
    if (visited.has(key)) return
    const existing = candidates.get(key)
    if (!existing || preference < existing.preference) {
      candidates.set(key, {
        dx,
        dy,
        preference,
        cost: candidateCost({ dx, dy, preference }, rectangle),
      })
    }
  }
  addCandidate(0, 0, -2)
  for (const preferred of rectangle.preferredShifts ?? []) {
    addCandidate(preferred.dx, preferred.dy, -1)
  }

  while (candidates.size > 0 && visited.size < MAX_LABEL_SHIFT_CANDIDATES) {
    let candidate: { dx: number; dy: number; preference: number; cost: number } | undefined
    for (const queued of candidates.values()) {
      if (!candidate || queued.cost < candidate.cost) candidate = queued
    }
    if (!candidate) return undefined
    const key = `${candidate.dx}:${candidate.dy}`
    candidates.delete(key)
    visited.add(key)

    const shifted = {
      ...rectangle,
      x: rectangle.x + candidate.dx,
      y: rectangle.y + candidate.dy,
    }
    const blockers = occupied.findOverlaps(shifted)
    if (blockers.length === 0) return { dx: candidate.dx, dy: candidate.dy }

    const blockerBounds = blockers.reduce(
      (bounds, blocker) => ({
        minX: Math.min(bounds.minX, blocker.x),
        minY: Math.min(bounds.minY, blocker.y),
        maxX: Math.max(bounds.maxX, blocker.x + blocker.width),
        maxY: Math.max(bounds.maxY, blocker.y + blocker.height),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    )
    const left = blockerBounds.minX - LABEL_PLACEMENT_GAP_PX - rectangle.width - rectangle.x
    const right = blockerBounds.maxX + LABEL_PLACEMENT_GAP_PX - rectangle.x
    const above = blockerBounds.minY - LABEL_PLACEMENT_GAP_PX - rectangle.height - rectangle.y
    const below = blockerBounds.maxY + LABEL_PLACEMENT_GAP_PX - rectangle.y

    addCandidate(candidate.dx, above)
    addCandidate(candidate.dx, below)
    addCandidate(left, candidate.dy)
    addCandidate(right, candidate.dy)
    addCandidate(left, above)
    addCandidate(right, above)
    addCandidate(left, below)
    addCandidate(right, below)
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
  if (floorplanAnnotationObstacleMode(geometry)) return true
  if (geometry.kind !== 'group') return false
  const hasPlate = geometry.children.some(
    (child) => child.kind === 'rect' || child.kind === 'circle',
  )
  const hasUprightText = geometry.children.some((child) => child.kind === 'text' && child.upright)
  return hasPlate && hasUprightText
}

export function floorplanAnnotationObstacleMode(
  geometry: FloorplanGeometry,
): 'bounds' | 'outline' | '' | undefined {
  const metadata = readFloorplanGeometryMetadata(geometry)
  if (metadata.annotationObstacle) return metadata.annotationObstacle
  switch (metadata.annotationRole) {
    case 'room-label':
      return geometry.kind === 'text' ? 'bounds' : undefined
    case 'column-center':
      return geometry.kind === 'line' || geometry.kind === 'text' ? 'bounds' : undefined
    case 'stair-annotation':
      return geometry.kind === 'polyline' || geometry.kind === 'line' ? 'outline' : 'bounds'
    default:
      return undefined
  }
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
