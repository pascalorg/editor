import type {
  ColumnNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for column. Inlined from the legacy
 * `getColumnPlanFootprint` helper in `floorplan-panel.tsx`. The
 * footprint shape depends on `crossSection` (square / rectangular /
 * round / octagonal / sixteen-sided) and `supportStyle` (vertical /
 * a-frame / x-brace / etc.) — brace supports use a rotated rectangle
 * spanning the base spread; standalone columns use the shaft profile.
 *
 * When selected, switches to a themed accent stroke and emits a move
 * handle at the column center. No dimension overlay (columns don't
 * have a natural "length" axis like a wall).
 */
export function buildColumnFloorplan(
  node: ColumnNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const polygon = getColumnPlanFootprint(node)
  if (polygon.length < 3) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const stroke = showSelectedChrome && palette ? palette.selectedStroke : '#374151'
  const fill = showSelectedChrome ? '#fed7aa' : '#9ca3af'

  const points: FloorplanPoint[] = polygon.map((p) => [p.x, p.y] as FloorplanPoint)

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill,
      stroke,
      strokeWidth: showSelectedChrome ? 0.03 : 0.02,
      opacity: 0.92,
    },
  ]

  // Hatch overlay on selected — same `<defs>` pattern as the wall.
  if (isSelected && palette) {
    children.push({
      kind: 'hatch',
      points,
      color: palette.selectedHatch,
      opacity: 0.7,
    })
  }

  // Move handle at the column center when selected.
  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [node.position[0], node.position[2]],
    })
  }

  return { kind: 'group', children }
}

// ── Inlined helpers from legacy floorplan-panel.tsx ───────────────────

type PlanPoint = { x: number; y: number }

function rotatePlanVector(x: number, y: number, rotation: number): [number, number] {
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  return [x * c - y * s, x * s + y * c]
}

function getRotatedRectanglePolygon(
  center: PlanPoint,
  width: number,
  depth: number,
  rotation: number,
): PlanPoint[] {
  const halfW = width / 2
  const halfD = depth / 2
  const corners: Array<[number, number]> = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ]
  return corners.map(([x, y]) => {
    const [rx, ry] = rotatePlanVector(x, y, rotation)
    return { x: center.x + rx, y: center.y + ry }
  })
}

function getColumnPlanFootprint(column: ColumnNode): PlanPoint[] {
  const center: PlanPoint = { x: column.position[0], y: column.position[2] }

  // Brace-support columns: rotated rectangle spanning the base spread.
  if (
    column.supportStyle === 'a-frame' ||
    column.supportStyle === 'y-frame' ||
    column.supportStyle === 'v-frame' ||
    column.supportStyle === 'x-brace' ||
    column.supportStyle === 'k-brace' ||
    column.supportStyle === 'single-strut' ||
    column.supportStyle === 'tripod' ||
    column.supportStyle === 'trestle' ||
    column.supportStyle === 'portal-frame' ||
    column.supportStyle === 'box-frame'
  ) {
    const width = Math.max(
      column.supportStyle === 'a-frame' ||
        column.supportStyle === 'x-brace' ||
        column.supportStyle === 'k-brace' ||
        column.supportStyle === 'single-strut' ||
        column.supportStyle === 'tripod' ||
        column.supportStyle === 'trestle' ||
        column.supportStyle === 'portal-frame' ||
        column.supportStyle === 'box-frame'
        ? (column.braceBottomSpread ?? 1.2)
        : 0,
      column.braceTopSpread ??
        (column.supportStyle === 'y-frame' ||
        column.supportStyle === 'v-frame' ||
        column.supportStyle === 'x-brace' ||
        column.supportStyle === 'k-brace' ||
        column.supportStyle === 'single-strut' ||
        column.supportStyle === 'tripod' ||
        column.supportStyle === 'trestle' ||
        column.supportStyle === 'portal-frame' ||
        column.supportStyle === 'box-frame'
          ? 1
          : 0),
      (column.braceWidth ?? column.width) * 2,
    )
    const depth = Math.max(
      column.supportStyle === 'tripod' ||
        column.supportStyle === 'trestle' ||
        column.supportStyle === 'box-frame'
        ? (column.braceTopSpread ?? 1)
        : 0,
      column.braceDepth ?? column.depth,
      0.08,
    )
    return getRotatedRectanglePolygon(center, width, depth, column.rotation)
  }

  // Standalone column: shaft profile expanded for base + capital.
  const isRound =
    column.crossSection === 'round' ||
    column.crossSection === 'octagonal' ||
    column.crossSection === 'sixteen-sided'
  const shaftWidth = isRound ? column.radius * 2 : column.width
  const shaftDepth = isRound ? column.radius * 2 : column.depth
  const width = Math.max(
    shaftWidth,
    column.width * column.baseWidthScale,
    column.width * column.capitalWidthScale,
  )
  const depth = Math.max(
    shaftDepth,
    column.depth * column.baseDepthScale,
    column.depth * column.capitalDepthScale,
  )

  if (column.crossSection === 'square' || column.crossSection === 'rectangular') {
    return getRotatedRectanglePolygon(center, width, depth, column.rotation)
  }

  const segmentCount =
    column.crossSection === 'octagonal' ? 8 : column.crossSection === 'sixteen-sided' ? 16 : 32

  return Array.from({ length: segmentCount }, (_, index) => {
    const angle = (index / segmentCount) * Math.PI * 2
    const localX = Math.cos(angle) * (width / 2)
    const localY = Math.sin(angle) * (depth / 2)
    const [offsetX, offsetY] = rotatePlanVector(localX, localY, column.rotation)
    return { x: center.x + offsetX, y: center.y + offsetY }
  })
}
