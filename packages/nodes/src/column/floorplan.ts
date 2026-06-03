import type {
  ColumnNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
} from '@pascal-app/core'
import type { ColumnResizePayload } from './floorplan-affordances'

// Offsets for the floor-plan selection arrows. Resize chevrons hug the
// footprint a hair off the rim; the rotate-arrow corner sits a bit
// further out so it doesn't crowd the resize arrows.
const RESIZE_ARROW_OFFSET = 0.12
const ROTATE_ARROW_CORNER_OFFSET = 0.22

const ROUND_CROSS_SECTIONS = new Set<ColumnNode['crossSection']>([
  'round',
  'octagonal',
  'sixteen-sided',
])

/**
 * Stage C floor-plan builder for column. Inlined from the legacy
 * `getColumnPlanFootprint` helper in `floorplan-panel.tsx`. The
 * footprint shape depends on `crossSection` (square / rectangular /
 * round / octagonal / sixteen-sided) and `supportStyle` (vertical /
 * a-frame / x-brace / etc.) — brace supports use a rotated rectangle
 * spanning the base spread; standalone columns use the shaft profile.
 *
 * When selected, switches to a themed accent stroke and emits the
 * orange move-handle dot, four perpendicular side move-arrows for
 * dragging the body, and a rotate-arrow at the front-right corner.
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

  // Selection chrome — move-handle dot at the centre (body move), one
  // resize chevron per dimension the 3D handle set exposes (radius /
  // uniform / width+depth or brace-width+brace-depth + per-style spread
  // arrows), and a rotate-arrow at the front-right corner. Mirrors
  // `column/definition.ts`'s handle selection so what users can
  // manipulate in 3D top-view is the same in the floor plan.
  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [node.position[0], node.position[2]],
    })

    const cx = node.position[0]
    const cz = node.position[2]
    // Floor-plan plots at `-rotation` so SVG-CW maps to Three.js-CCW.
    // Selection chrome (side arrows, rotate-arrow) follows the same
    // convention so it stays glued to the rotated footprint.
    const rot = -node.rotation
    const emitArrowAlong = (
      dim: ColumnResizePayload['dim'],
      localDirection: 'x' | 'z',
      localOffsetDistance: number,
    ) => {
      // Local position of the arrow's chevron tip relative to the
      // column centre. The chevron sits a hair past the dimension's
      // current half-extent so it never overlaps the footprint stroke.
      const localPos: [number, number] =
        localDirection === 'x' ? [localOffsetDistance, 0] : [0, localOffsetDistance]
      const [worldOffsetX, worldOffsetZ] = rotatePlanVector(localPos[0], localPos[1], rot)
      // The cursor projection axis: same direction as the arrow's
      // outward tip in plan coords. Captured at emit-time so the
      // affordance doesn't need to recompute `column.rotation` (and
      // a mid-drag rotation can't drift the projection basis).
      const outwardLocal: [number, number] = localDirection === 'x' ? [1, 0] : [0, 1]
      const [planAxisX, planAxisY] = rotatePlanVector(outwardLocal[0], outwardLocal[1], rot)
      children.push({
        kind: 'move-arrow',
        point: [cx + worldOffsetX, cz + worldOffsetZ],
        angle: Math.atan2(planAxisY, planAxisX),
        affordance: 'column-resize',
        payload: { dim, planAxis: [planAxisX, planAxisY] } satisfies ColumnResizePayload,
      })
    }

    if (node.supportStyle !== 'vertical') {
      // Brace columns — width + depth of the bracing structure. Spread
      // arrows (top + bottom) project to the same XZ in top-view, so
      // we only surface bracing dimensions here. The 3D set still has
      // spread arrows at different heights.
      const halfBraceX =
        Math.max(
          node.width,
          node.braceWidth ?? 0,
          node.braceBottomSpread ?? 0,
          node.braceTopSpread ?? 0,
        ) / 2
      const halfBraceZ = Math.max(node.depth, node.braceDepth ?? 0) / 2
      emitArrowAlong('brace-width', 'x', halfBraceX + RESIZE_ARROW_OFFSET)
      emitArrowAlong('brace-depth', 'z', halfBraceZ + RESIZE_ARROW_OFFSET)
    } else if (ROUND_CROSS_SECTIONS.has(node.crossSection)) {
      // Round shafts — single radius arrow. `radial-resize` factor 1
      // (cursor delta = radius delta), so dragging the chevron
      // outward 1 unit grows the column by 1 unit.
      emitArrowAlong('radius', 'x', node.radius + RESIZE_ARROW_OFFSET)
    } else if (node.crossSection === 'square') {
      // Square shafts — single uniform arrow that grows width + depth
      // together (matches 3D `columnUniformHandle`).
      emitArrowAlong('uniform', 'x', node.width / 2 + RESIZE_ARROW_OFFSET)
    } else {
      // Rectangular — independent width + depth arrows.
      emitArrowAlong('width', 'x', node.width / 2 + RESIZE_ARROW_OFFSET)
      emitArrowAlong('depth', 'z', node.depth / 2 + RESIZE_ARROW_OFFSET)
    }

    // Rotate-arrow at the +X / +Z corner — matches the 3D
    // `columnRotateHandle` corner placement so users see the rotation
    // affordance in the same quadrant across views.
    const { halfX, halfZ } = columnPlanHalfExtents(node)
    const cornerLocalX = halfX + ROTATE_ARROW_CORNER_OFFSET
    const cornerLocalZ = halfZ + ROTATE_ARROW_CORNER_OFFSET
    const [cornerWorldX, cornerWorldZ] = rotatePlanVector(cornerLocalX, cornerLocalZ, rot)
    const [radialX, radialZ] = rotatePlanVector(1, 1, rot)
    children.push({
      kind: 'rotate-arrow',
      point: [cx + cornerWorldX, cz + cornerWorldZ],
      angle: Math.atan2(radialZ, radialX),
      affordance: 'column-rotate',
      pivot: [cx, cz],
    })
  }

  return { kind: 'group', children }
}

// ── Inlined helpers from legacy floorplan-panel.tsx ───────────────────

type PlanPoint = { x: number; y: number }

/**
 * XZ half-extents for the column's plan footprint. Mirrors the 3D
 * `columnFootprintHalf` so side-arrows + rotate-arrow ring the same
 * bounding box the in-world handles use. Vertical supports read the
 * shaft geometry; non-vertical supports use the widest brace bound so
 * arrows clear the splay.
 */
function columnPlanHalfExtents(column: ColumnNode): { halfX: number; halfZ: number } {
  if (column.supportStyle !== 'vertical') {
    return {
      halfX:
        Math.max(
          column.width,
          column.braceWidth ?? 0,
          column.braceBottomSpread ?? 0,
          column.braceTopSpread ?? 0,
        ) / 2,
      halfZ: Math.max(column.depth, column.braceDepth ?? 0) / 2,
    }
  }
  if (
    column.crossSection === 'round' ||
    column.crossSection === 'octagonal' ||
    column.crossSection === 'sixteen-sided'
  ) {
    return { halfX: column.radius, halfZ: column.radius }
  }
  if (column.crossSection === 'square') {
    return { halfX: column.width / 2, halfZ: column.width / 2 }
  }
  return { halfX: column.width / 2, halfZ: column.depth / 2 }
}

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
    return getRotatedRectanglePolygon(center, width, depth, -column.rotation)
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
    return getRotatedRectanglePolygon(center, width, depth, -column.rotation)
  }

  const segmentCount =
    column.crossSection === 'octagonal' ? 8 : column.crossSection === 'sixteen-sided' ? 16 : 32

  return Array.from({ length: segmentCount }, (_, index) => {
    const angle = (index / segmentCount) * Math.PI * 2
    const localX = Math.cos(angle) * (width / 2)
    const localY = Math.sin(angle) * (depth / 2)
    const [offsetX, offsetY] = rotatePlanVector(localX, localY, -column.rotation)
    return { x: center.x + offsetX, y: center.y + offsetY }
  })
}
