import {
  type AnyNode,
  type ColumnNode,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  type StructuralGridNode,
  scriptImages,
} from '@pascal-app/core'
import { floorplanGeometryMetadata } from '@pascal-app/editor'
import {
  collectStructuralGridAxes,
  resolveStructuralGridReference,
} from '../structural-grid/coordination'
import { columnFootprintHalf } from './bounds'
import { isManagedColumn } from './edit-policy'
import type { ColumnResizePayload } from './floorplan-affordances'

// Offsets for the floor-plan selection arrows. Resize chevrons hug the
// footprint a hair off the rim; the rotate-arrow corner sits a bit
// further out so it doesn't crowd the resize arrows.
const RESIZE_ARROW_OFFSET = 0.12
const ROTATE_ARROW_CORNER_OFFSET = 0.22
const GRID_REFERENCE_OFFSET = 0.16
const GRID_REFERENCE_FONT_SIZE = 0.13

const ROUND_CROSS_SECTIONS = new Set<ColumnNode['crossSection']>([
  'round',
  'octagonal',
  'sixteen-sided',
])

export type ColumnFloorplanLevelData = {
  structuralGrids: StructuralGridNode[]
}

export function computeColumnFloorplanLevelData({
  siblings,
  nodes,
}: {
  siblings: readonly ColumnNode[]
  nodes: Record<string, AnyNode>
}): ColumnFloorplanLevelData {
  return {
    structuralGrids: collectStructuralGridAxes(nodes, siblings[0]?.parentId),
  }
}

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
  const points = getColumnFloorplanFootprint(node)
  if (points.length < 3) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const hovered = view?.hovered ?? false
  const stroke = hovered
    ? (palette?.wallHoverStroke ?? '#38bdf8')
    : showSelectedChrome && palette
      ? palette.selectedStroke
      : '#374151'
  const fill = showSelectedChrome ? '#fed7aa' : '#9ca3af'
  // A scripted column draws its floor-plan image the way a catalog item does.
  const floorPlanUrl = scriptImages(node)?.floorPlan

  const body: FloorplanGeometry = {
    kind: 'polygon',
    points,
    // Transparent, not none: the body stays the hit target under the image.
    fill: floorPlanUrl ? 'transparent' : fill,
    stroke,
    strokeWidth: hovered ? 0.045 : showSelectedChrome ? 0.03 : 0.02,
    opacity: 0.92,
    metadata: floorplanGeometryMetadata({ annotationObstacle: 'bounds' }),
  }
  const children: FloorplanGeometry[] = node.children.length
    ? [
        // Occupied columns keep label bounds in the overlay without covering their children.
        {
          kind: 'polygon',
          points,
          fill: 'none',
          stroke: 'none',
          pointerEvents: 'none',
          metadata: body.metadata,
        },
        { ...body, metadata: undefined },
      ]
    : [body]
  if (floorPlanUrl && node.source) {
    const { min, max } = node.source.manifest.bounds
    const [cx, cz] = points
      .reduce((sum, [x, z]) => [sum[0] + x, sum[1] + z], [0, 0])
      .map((total) => total / points.length) as [number, number]
    children.push({
      kind: 'image',
      url: floorPlanUrl,
      center: [cx, cz],
      width: max[0] - min[0],
      height: max[2] - min[2],
      // The footprint turns by R(-rotation); the renderer's SVG rotate is R(+angle).
      rotation: -node.rotation,
    })
    // The selection ring goes back on top of the image.
    if (showSelectedChrome)
      children.push({ ...body, fill: 'none', pointerEvents: 'none', metadata: undefined })
  }
  const { halfX, halfZ } = columnFootprintHalf(node)
  const centerMarkHalf = Math.min(0.09, Math.max(0.035, Math.min(halfX, halfZ) * 0.45))
  const centerX = node.position[0]
  const centerZ = node.position[2]
  children.push(
    {
      kind: 'line',
      x1: centerX - centerMarkHalf,
      y1: centerZ - centerMarkHalf,
      x2: centerX + centerMarkHalf,
      y2: centerZ + centerMarkHalf,
      stroke,
      strokeWidth: 0.9,
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'none',
      metadata: floorplanGeometryMetadata({ annotationRole: 'column-center' }),
    },
    {
      kind: 'line',
      x1: centerX - centerMarkHalf,
      y1: centerZ + centerMarkHalf,
      x2: centerX + centerMarkHalf,
      y2: centerZ - centerMarkHalf,
      stroke,
      strokeWidth: 0.9,
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'none',
      metadata: floorplanGeometryMetadata({ annotationRole: 'column-center' }),
    },
  )

  const levelData = ctx.levelData as ColumnFloorplanLevelData | undefined
  const gridReference = resolveStructuralGridReference(
    [centerX, centerZ],
    levelData?.structuralGrids ?? [],
  )
  if (gridReference) {
    children.push({
      kind: 'text',
      x: centerX,
      y: centerZ + halfZ + GRID_REFERENCE_OFFSET,
      text: gridReference,
      fontSize: GRID_REFERENCE_FONT_SIZE,
      fill: stroke,
      fontWeight: 700,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      upright: true,
      metadata: floorplanGeometryMetadata({ annotationRole: 'column-center' }),
    })
  }

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
    if (!isManagedColumn(node))
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

    if (node.source) {
      const params = new Set(node.source.manifest.params.map((spec) => spec.id))
      if (params.has('width')) emitArrowAlong('width', 'x', node.width / 2 + RESIZE_ARROW_OFFSET)
      if (params.has('depth')) emitArrowAlong('depth', 'z', node.depth / 2 + RESIZE_ARROW_OFFSET)
    } else if (node.supportStyle !== 'vertical') {
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
    } else if (isManagedColumn(node)) {
      // The parent assembly owns this post's footprint.
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

export function getColumnFloorplanFootprint(node: ColumnNode): FloorplanPoint[] {
  if (node.source) {
    const cos = Math.cos(node.rotation),
      sin = Math.sin(node.rotation)
    const { min, max } = node.source.manifest.bounds
    const footprint: [number, number][] = [
      [min[0], min[2]],
      [max[0], min[2]],
      [max[0], max[2]],
      [min[0], max[2]],
    ]
    return footprint.map(([x, z]) => [
      node.position[0] + x * cos + z * sin,
      node.position[2] - x * sin + z * cos,
    ])
  }
  return getColumnPlanFootprint(node).map((point) => [point.x, point.y])
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
  const { halfX, halfZ } = columnFootprintHalf(column)
  if (
    column.supportStyle === 'vertical' &&
    column.style !== 'cluster' &&
    ROUND_CROSS_SECTIONS.has(column.crossSection) &&
    column.baseStyle === 'none' &&
    ['none', 'simple', 'simple-slab'].includes(column.capitalStyle) &&
    column.panelCount === 0 &&
    column.shaftDetail !== 'panelled'
  ) {
    const segments =
      column.crossSection === 'octagonal' ? 8 : column.crossSection === 'sixteen-sided' ? 16 : 32
    return Array.from({ length: segments }, (_, i) => {
      const angle = (i * Math.PI * 2) / segments
      const [x, z] = rotatePlanVector(
        Math.sin(angle) * halfX,
        Math.cos(angle) * halfZ,
        -column.rotation,
      )
      return { x: column.position[0] + x, y: column.position[2] + z }
    })
  }
  return getRotatedRectanglePolygon(
    { x: column.position[0], y: column.position[2] },
    halfX * 2,
    halfZ * 2,
    -column.rotation,
  )
}
