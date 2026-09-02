import {
  type AnyNode,
  calculateLevelLayerMiters,
  calculateLevelMiters,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallLayerPolylines,
  getWallMidpointHandlePoint,
  getWallPlanFootprint,
  getWallThickness,
  isCurvedWall,
  type WallLayerMiterData,
  type WallLayerPolyline,
  type WallMiterData,
  type WallNode,
  wallLayerBoundaryOffsets,
} from '@pascal-app/core'
import { floorplanGeometryMetadata, readFloorplanContext } from '@pascal-app/editor'
import { constructionDimensionStandard } from '../shared/construction-dimension-standards'
import {
  buildCurvedWallConstructionDimensions,
  buildLevelWallConstructionDimensionPlan,
  buildWallConstructionDimensions,
  renderPlannedConstructionDimensions,
  type WallConstructionDimensionPlan,
} from './construction-dimensions'

// Same constants the legacy `getFloorplanWall` uses (editor/lib/floorplan/walls.ts).
// Slightly exaggerates thin walls so the 2D plan stays legible without
// drifting from BIM data. Inlined to keep nodes/wall self-contained.
const FLOORPLAN_WALL_THICKNESS_SCALE = 1.18
const FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS = 0.13
const FLOORPLAN_MAX_EXTRA_THICKNESS = 0.035
const FLOORPLAN_SELECTION_HATCH_SPACING = 0.12
const FLOORPLAN_SELECTED_WALL_STROKE_WIDTH = 0.03
const FLOORPLAN_SELECTION_HATCH_STROKE_WIDTH = 0.02
const WALL_DIMENSION_REFERENCES = ['finished-faces', 'centerline', 'stud-faces'] as const

type WallDimensionReference = (typeof WALL_DIMENSION_REFERENCES)[number]

function floorplanWallThickness(wall: WallNode): number {
  const baseThickness = getWallThickness(wall)
  const scaledThickness = baseThickness * FLOORPLAN_WALL_THICKNESS_SCALE
  return Math.min(
    baseThickness + FLOORPLAN_MAX_EXTRA_THICKNESS,
    Math.max(baseThickness, scaledThickness, FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS),
  )
}

function exaggerateWallThickness(wall: WallNode): WallNode {
  return { ...wall, thickness: floorplanWallThickness(wall) }
}

export type WallFloorplanLevelData = {
  miters: WallMiterData
  documentMiters: WallMiterData
  layerMiters: WallLayerMiterData
  documentLayerMiters: WallLayerMiterData
  constructionDimensionsByReference: Record<WallDimensionReference, WallConstructionDimensionPlan>
}

// --- Assembly layer lines ---------------------------------------------------
//
// The mitered outer footprint is unchanged; these are the boundaries BETWEEN
// the assembly's layers, offset in from the footprint and mitered at the same
// corners so they meet cleanly (see `calculateLevelLayerMiters` in
// `packages/core/src/systems/wall/wall-assembly.ts` for the corner, T-junction
// and different-assembly rules).
//
// In `document` purpose the framing cavity gets the standard poché (a light
// hatch) and the finish layers are thin solid lines. In `edit` purpose the
// footprint keeps today's look and the layer lines are drawn at reduced
// opacity with no poché, so the editor stays readable.
//
// Curved walls are skipped: the offset miter is a straight-line construction
// and a curved wall's layers would need arc offsets. Stated plainly rather
// than approximated — a curved wall draws exactly as it does today.
const LAYER_LINE_STROKE = '#1f2937'
const LAYER_LINE_WIDTH_DOCUMENT = 0.008
const LAYER_LINE_WIDTH_EDIT = 0.006
const LAYER_LINE_OPACITY_EDIT = 0.35
const FRAMING_POCHE_COLOR = '#94a3b8'
const FRAMING_POCHE_OPACITY = 0.28

/** Along-wall spans, measured from `wall.start`, occupied by doors / windows. */
function openingSpans(wall: WallNode, children: AnyNode[]): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const child of children) {
    if (child.type !== 'door' && child.type !== 'window') continue
    const distance = child.position?.[0]
    const width = (child as { width?: number }).width
    if (typeof distance !== 'number' || typeof width !== 'number' || width <= 0) continue
    spans.push([distance - width / 2, distance + width / 2])
  }
  return spans.sort((a, b) => a[0] - b[0])
}

/**
 * Cut one mitered layer boundary at the openings hosted by the wall, so an
 * opening reads as a hole through EVERY layer and not just the footprint.
 * Parameterised along the wall direction, which is exact for straight walls.
 */
function cutAtOpenings(
  line: WallLayerPolyline,
  wall: WallNode,
  spans: Array<[number, number]>,
): Array<{ start: FloorplanPoint; end: FloorplanPoint }> {
  const segment = {
    start: [line.start.x, line.start.y] as FloorplanPoint,
    end: [line.end.x, line.end.y] as FloorplanPoint,
  }
  if (spans.length === 0) return [segment]

  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return [segment]
  const ux = dx / length
  const uy = dy / length
  const along = (p: { x: number; y: number }) =>
    (p.x - wall.start[0]) * ux + (p.y - wall.start[1]) * uy
  const a0 = along(line.start)
  const a1 = along(line.end)
  if (Math.abs(a1 - a0) < 1e-9) return [segment]

  const at = (t: number): FloorplanPoint => [
    line.start.x + (line.end.x - line.start.x) * t,
    line.start.y + (line.end.y - line.start.y) * t,
  ]
  const toT = (distance: number) => (distance - a0) / (a1 - a0)

  const pieces: Array<{ start: FloorplanPoint; end: FloorplanPoint }> = []
  let cursor = 0
  for (const [lo, hi] of spans) {
    const tLo = Math.max(0, Math.min(1, toT(lo)))
    const tHi = Math.max(0, Math.min(1, toT(hi)))
    const from = Math.min(tLo, tHi)
    const to = Math.max(tLo, tHi)
    if (from > cursor + 1e-6) pieces.push({ start: at(cursor), end: at(from) })
    cursor = Math.max(cursor, to)
  }
  if (cursor < 1 - 1e-6) pieces.push({ start: at(cursor), end: at(1) })
  return pieces
}

/**
 * The layer-boundary lines plus the framing poché for one wall.
 * `wall` is the (possibly exaggerated) wall the footprint was built from, so
 * the stack is scaled to whatever thickness is actually drawn.
 */
function buildWallAssemblyLayers(
  wall: WallNode,
  source: WallNode,
  layerMiters: WallLayerMiterData,
  children: AnyNode[],
  documentMode: boolean,
): FloorplanGeometry[] {
  if (!source.assembly || isCurvedWall(source)) return []
  const offsets = wallLayerBoundaryOffsets(wall, getWallThickness(wall))
  if (offsets.length < 3) return []
  const lines = getWallLayerPolylines(wall, layerMiters, offsets)
  if (lines.length < 3) return []

  const spans = openingSpans(source, children)
  const out: FloorplanGeometry[] = []

  // Framing poché first, so the boundary lines sit on top of it.
  if (documentMode) {
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (lines[i + 1]!.role !== 'framing') continue
      const outer = lines[i]!
      const inner = lines[i + 1]!
      out.push({
        kind: 'hatch',
        points: [
          [outer.start.x, outer.start.y],
          [outer.end.x, outer.end.y],
          [inner.end.x, inner.end.y],
          [inner.start.x, inner.start.y],
        ],
        color: FRAMING_POCHE_COLOR,
        opacity: FRAMING_POCHE_OPACITY,
      })
    }
  }

  // Interior boundaries only — index 0 and the last index are the two outer
  // faces, already drawn by the mitered footprint polygon.
  for (let i = 1; i < lines.length - 1; i += 1) {
    for (const piece of cutAtOpenings(lines[i]!, source, spans)) {
      out.push({
        kind: 'line',
        x1: piece.start[0],
        y1: piece.start[1],
        x2: piece.end[0],
        y2: piece.end[1],
        stroke: LAYER_LINE_STROKE,
        strokeWidth: documentMode ? LAYER_LINE_WIDTH_DOCUMENT : LAYER_LINE_WIDTH_EDIT,
        opacity: documentMode ? 1 : LAYER_LINE_OPACITY_EDIT,
        pointerEvents: 'none',
        metadata: floorplanGeometryMetadata({ renderPass: 'overlay' }),
      })
    }
  }

  return out
}

export function computeWallFloorplanLevelData({
  siblings,
  nodes,
}: {
  siblings: ReadonlyArray<WallNode>
  nodes: Record<string, AnyNode>
}): WallFloorplanLevelData {
  const walls = siblings.map(exaggerateWallThickness)
  const constructionDimensionsByReference = {} as Record<
    WallDimensionReference,
    WallConstructionDimensionPlan
  >
  for (const reference of WALL_DIMENSION_REFERENCES) {
    let cached: WallConstructionDimensionPlan | undefined
    Object.defineProperty(constructionDimensionsByReference, reference, {
      enumerable: true,
      get: () => {
        if (cached) return cached
        const datumPolicy =
          reference === 'finished-faces'
            ? 'wall-face'
            : reference === 'stud-faces'
              ? 'structural-face'
              : 'centerline'
        cached = buildLevelWallConstructionDimensionPlan(
          siblings,
          nodes,
          constructionDimensionStandard({
            datumPolicy,
            ...(reference === 'finished-faces'
              ? { intersectionReferencePolicy: 'both-faces' as const }
              : {}),
          }),
        )
        return cached
      },
    })
  }
  const documentWalls = [...siblings]
  const miters = calculateLevelMiters(walls)
  const documentMiters = calculateLevelMiters(documentWalls)
  const layerOffsets = (wall: WallNode) => wallLayerBoundaryOffsets(wall, getWallThickness(wall))
  return {
    miters,
    documentMiters,
    layerMiters: calculateLevelLayerMiters(walls, miters, layerOffsets),
    documentLayerMiters: calculateLevelLayerMiters(documentWalls, documentMiters, layerOffsets),
    constructionDimensionsByReference,
  }
}

/**
 * Stage C floor-plan builder for wall — emits the full chrome stack the
 * legacy `floorplan-panel.tsx` rendered inline:
 *
 *   1. The mitered footprint polygon (themed fill + stroke).
 *   2. A diagonal hatch overlay when selected.
 *   3. A transparent hit-line on the centerline so the user can grab the
 *      wall body easily.
 *   4. Two endpoint handles (start + end) when selected — the registry
 *      layer hosts the 5-circle stack + hover transitions + 2D drag.
 *   5. Exterior facade strings plus interior wall spans and hosted-opening widths.
 *
 * `ctx.levelData` provides the shared level miter graph when the floor-plan
 * dispatcher precomputes it; `ctx.siblings` remains the fallback path for
 * direct builder callers.
 */
export function buildWallFloorplan(node: WallNode, ctx: GeometryContext): FloorplanGeometry | null {
  const { automaticDimensions, metricNotation, purpose, wallDimensionReference } =
    readFloorplanContext(ctx)
  const documentMode = purpose === 'document'
  const wallForPurpose = (wall: WallNode) => (documentMode ? wall : exaggerateWallThickness(wall))
  const self = wallForPurpose(node)
  // Prefer the level-batch miter graph the floor-plan dispatcher precomputes
  // once per pass (`computeWallFloorplanLevelData`). Only the fallback path —
  // a direct builder caller with no shared data — pays the O(N) exaggerate +
  // level-wide miter calc per wall; the dispatcher path is O(1) here, which is
  // what keeps a wall drag from being O(N²) across the level.
  const levelData = ctx.levelData as WallFloorplanLevelData | undefined
  const purposeWalls = [
    self,
    ...ctx.siblings.filter((s): s is AnyNode & WallNode => s.type === 'wall').map(wallForPurpose),
  ]
  const miters =
    (documentMode ? levelData?.documentMiters : levelData?.miters) ??
    calculateLevelMiters(purposeWalls)
  const layerMiters =
    (documentMode ? levelData?.documentLayerMiters : levelData?.layerMiters) ??
    calculateLevelLayerMiters(purposeWalls, miters, (wall) =>
      wallLayerBoundaryOffsets(wall, getWallThickness(wall)),
    )

  const polygon = getWallPlanFootprint(self, miters)
  if (!polygon || polygon.length < 3) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const isHovered = view?.hovered ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const points = polygon.map((p) => [p.x, p.y] as FloorplanPoint)

  // Stroke colour shifts: selected → theme accent; hover (when not
  // selected) → palette.wallHoverStroke (light blue from the legacy);
  // otherwise the dark grey carries through. Mirrors the legacy
  // `wallStroke` ternary in floorplan-panel.tsx around line 4356.
  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : '#1f2937'
  const fill = showSelectedChrome ? '#ffffff' : '#374151'

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill,
      stroke,
      strokeWidth: showSelectedChrome ? FLOORPLAN_SELECTED_WALL_STROKE_WIDTH : 0.02,
      opacity: 0.92,
      metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
      // Once the wall is selected, the body keeps catching the pointer
      // so the cursor stays neutral (no drag/pointer affordance from
      // the slab below leaking through), but only the side-arrows and
      // endpoint handles should start a drag — the wrapper g's click
      // handler is a no-op re-select for the already-selected wall.
      cursor: isSelected ? 'default' : undefined,
    },
  ]

  // Assembly layer lines + framing poché, drawn inside the footprint.
  children.push(...buildWallAssemblyLayers(self, node, layerMiters, ctx.children, documentMode))

  if (automaticDimensions) {
    const dimensionStroke =
      isSelected && palette ? palette.selectedStroke : (palette?.measurementStroke ?? '#334155')
    const dimensionStandard = constructionDimensionStandard({
      datumPolicy: wallDimensionDatumPolicy(wallDimensionReference),
      metricNotation,
    })
    const exteriorCornerDimensionStandard = constructionDimensionStandard({
      datumPolicy: 'structural-face',
      metricNotation,
    })
    if (isCurvedWall(node)) {
      children.push(
        ...buildCurvedWallConstructionDimensions(self, {
          unit: view?.unit ?? 'metric',
          stroke: dimensionStroke,
          profile: documentMode ? 'document' : 'editor',
          standard: exteriorCornerDimensionStandard,
          siblings: ctx.siblings.filter(
            (sibling): sibling is AnyNode & WallNode => sibling.type === 'wall',
          ),
        }),
      )
    } else {
      const planned = levelData?.constructionDimensionsByReference[wallDimensionReference].get(
        node.id,
      )
      if (planned) {
        children.push(
          ...renderPlannedConstructionDimensions(
            planned,
            view?.unit ?? 'metric',
            dimensionStroke,
            documentMode ? 'document' : 'editor',
            dimensionStandard,
          ),
        )
      } else if (!levelData) {
        children.push(
          ...buildWallConstructionDimensions(self, ctx, {
            unit: view?.unit ?? 'metric',
            stroke: dimensionStroke,
            profile: documentMode ? 'document' : 'editor',
            standard: exteriorCornerDimensionStandard,
          }),
        )
      }
    }
  }

  // Selection hatch overlay — only when the wall is *the* selected item
  // (not when it's just marquee-highlighted), matching the legacy.
  if (isSelected && palette) {
    children.push(...buildSelectedWallHatchLines(self, palette.selectedHatch))
  }

  // Hit-line on the centerline. Stroke width is in screen pixels so it
  // stays clickable at any zoom. Skipped while selected — the user has
  // the side-arrows / endpoint handles by then, and leaving the hit-line
  // live would re-introduce a "click-and-drag the wall body" path.
  if (!isSelected) {
    children.push({
      kind: 'hit-line',
      x1: node.start[0],
      y1: node.start[1],
      x2: node.end[0],
      y2: node.end[1],
      strokeWidthPx: 18,
      cursor: 'pointer',
    })
  }

  // Endpoint handles only when the user has actively selected this wall.
  if (isSelected) {
    children.push({
      kind: 'endpoint-handle',
      point: [node.start[0], node.start[1]],
      state: 'idle',
      affordance: 'move-endpoint',
      payload: { wallId: node.id, endpoint: 'start' as const },
    })
    children.push({
      kind: 'endpoint-handle',
      point: [node.end[0], node.end[1]],
      state: 'idle',
      affordance: 'move-endpoint',
      payload: { wallId: node.id, endpoint: 'end' as const },
    })

    // Side move arrows — two directional arrows at the wall midpoint,
    // pointing outward perpendicular to the wall. Mirrors the 3D
    // `WallMoveSideHandles` arrows so users can grab the wall body
    // from the floor plan. PointerDown on either arrow activates
    // `wallFloorplanMoveTarget` via the registry-layer dispatcher.
    {
      const dx = node.end[0] - node.start[0]
      const dz = node.end[1] - node.start[1]
      const wallLength = Math.hypot(dx, dz)
      if (wallLength > 1e-6) {
        const midpoint = getWallMidpointHandlePoint(node)
        const nx = -dz / wallLength
        const nz = dx / wallLength
        const offset = floorplanWallThickness(node) / 2 + 0.05
        children.push({
          kind: 'move-arrow',
          point: [midpoint.x + nx * offset, midpoint.y + nz * offset],
          angle: Math.atan2(nz, nx),
        })
        children.push({
          kind: 'move-arrow',
          point: [midpoint.x - nx * offset, midpoint.y - nz * offset],
          angle: Math.atan2(-nz, -nx),
        })
      }
    }

    // Curve sagitta handle — teal dot at the wall midpoint that
    // controls `curveOffset`. Hidden when the wall hosts a door /
    // window / wall-attached item: bending the wall would tear those
    // children, so the legacy disables the handle in that case (see
    // `wallCurveHandles.hasWallChildrenBlockingCurve`).
    if (!hasCurveBlockingChildren(ctx.children)) {
      const handle = getWallMidpointHandlePoint(node)
      children.push({
        kind: 'endpoint-handle',
        point: [handle.x, handle.y],
        state: 'idle',
        variant: 'curve',
        affordance: 'curve',
        payload: { wallId: node.id },
      })
    }
  }

  return { kind: 'group', children }
}

function buildSelectedWallHatchLines(wall: WallNode, stroke: string): FloorplanGeometry[] {
  const length = getWallCurveLength(wall)
  if (length <= 1e-6) return []

  const halfAcross = getWallThickness(wall) / 2
  const halfAlong = halfAcross
  const count = Math.max(1, Math.floor(length / FLOORPLAN_SELECTION_HATCH_SPACING))
  const spacing = length / count
  const lines: FloorplanGeometry[] = []

  for (let index = 0; index < count; index += 1) {
    const along = (index + 0.5) * spacing
    const frame = getWallCurveFrameAt(wall, along / length)
    lines.push({
      kind: 'line',
      x1: frame.point.x - frame.tangent.x * halfAlong - frame.normal.x * halfAcross,
      y1: frame.point.y - frame.tangent.y * halfAlong - frame.normal.y * halfAcross,
      x2: frame.point.x + frame.tangent.x * halfAlong + frame.normal.x * halfAcross,
      y2: frame.point.y + frame.tangent.y * halfAlong + frame.normal.y * halfAcross,
      stroke,
      strokeWidth: FLOORPLAN_SELECTION_HATCH_STROKE_WIDTH,
      pointerEvents: 'none',
      metadata: floorplanGeometryMetadata({ renderPass: 'overlay' }),
    })
  }

  return lines
}

function wallDimensionDatumPolicy(reference: WallDimensionReference) {
  switch (reference) {
    case 'centerline':
      return 'centerline' as const
    case 'stud-faces':
      return 'structural-face' as const
    case 'finished-faces':
      return 'wall-face' as const
  }
}

/**
 * Doors, windows, and wall-attached items would tear if the wall bent
 * around them, so the curve sagitta handle hides when any of those
 * children exist. Mirrors the legacy
 * `wallCurveHandles.hasWallChildrenBlockingCurve` check.
 */
function hasCurveBlockingChildren(children: AnyNode[]): boolean {
  for (const child of children) {
    if (child.type === 'door' || child.type === 'window') return true
    if (child.type === 'item') {
      const attachTo = (child as { asset?: { attachTo?: string } }).asset?.attachTo
      if (attachTo === 'wall' || attachTo === 'wall-side') return true
    }
  }
  return false
}
