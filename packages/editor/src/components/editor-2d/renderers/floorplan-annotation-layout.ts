export type AnnotationLabelRectangle = {
  id: string
  x: number
  y: number
  width: number
  height: number
  priority: number
}

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
): AnnotationLabelShift[] {
  const placed: Array<AnnotationLabelRectangle & { dx: number; dy: number }> = []
  const shifts = new Map<string, AnnotationLabelShift>()
  const ordered = [...rectangles].sort(
    (left, right) => right.priority - left.priority || right.width - left.width,
  )

  for (const rectangle of ordered) {
    const candidates = labelShiftCandidates(rectangle, placed)
    const selected = candidates.find(
      ({ dx, dy }) =>
        !placed.some((other) =>
          rectanglesOverlap(
            { ...rectangle, x: rectangle.x + dx, y: rectangle.y + dy },
            { ...other, x: other.x + other.dx, y: other.y + other.dy },
          ),
        ),
    )
    const shift = selected ?? { dx: 0, dy: 0 }
    const resolved = selected !== undefined
    placed.push({ ...rectangle, ...shift })
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
    return {
      id: label.dataset.floorplanAnnotationId ?? `annotation-${index}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      priority: Number(label.dataset.floorplanAnnotationPriority ?? 0),
    }
  })
  const shifts = resolveAnnotationLabelRectangles(rectangles)

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
  placed: ReadonlyArray<AnnotationLabelRectangle & { dx: number; dy: number }>,
) {
  const candidates = new Map<string, { dx: number; dy: number }>()
  const addCandidate = (dx: number, dy: number) => {
    candidates.set(`${dx}:${dy}`, { dx, dy })
  }
  addCandidate(0, 0)

  for (const other of placed) {
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
    (left, right) => Math.hypot(left.dx, left.dy) - Math.hypot(right.dx, right.dy),
  )
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
