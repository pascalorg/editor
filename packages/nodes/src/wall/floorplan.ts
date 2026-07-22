import {
  type AnyNode,
  calculateLevelMiters,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallAssemblyThickness,
  getWallMidpointHandlePoint,
  getWallPlanFootprint,
  isCurvedWall,
  type WallAssemblyLayer,
  type WallMiterData,
  type WallNode,
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
const FLOORPLAN_ASSEMBLY_GRAPHIC_MIN_SPACING = 0.06
const WALL_DIMENSION_REFERENCES = ['finished-faces', 'centerline', 'stud-faces'] as const

type WallDimensionReference = (typeof WALL_DIMENSION_REFERENCES)[number]

function floorplanWallThickness(wall: WallNode): number {
  const baseThickness = getWallAssemblyThickness(wall)
  const scaledThickness = baseThickness * FLOORPLAN_WALL_THICKNESS_SCALE
  return Math.min(
    baseThickness + FLOORPLAN_MAX_EXTRA_THICKNESS,
    Math.max(baseThickness, scaledThickness, FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS),
  )
}

function exaggerateWallThickness(wall: WallNode): WallNode {
  return { ...wall, thickness: floorplanWallThickness(wall) }
}

function wallWithModeledAssemblyThickness(wall: WallNode): WallNode {
  return { ...wall, thickness: getWallAssemblyThickness(wall) }
}

export type WallFloorplanLevelData = {
  miters: WallMiterData
  documentMiters: WallMiterData
  constructionDimensionsByReference: Record<WallDimensionReference, WallConstructionDimensionPlan>
}

export function computeWallFloorplanLevelData({
  siblings,
  nodes,
}: {
  siblings: ReadonlyArray<WallNode>
  nodes: Record<string, AnyNode>
}): WallFloorplanLevelData {
  const walls = siblings.map(exaggerateWallThickness)
  return {
    miters: calculateLevelMiters(walls),
    documentMiters: calculateLevelMiters([...siblings]),
    constructionDimensionsByReference: {
      'finished-faces': buildLevelWallConstructionDimensionPlan(
        siblings,
        nodes,
        constructionDimensionStandard({
          datumPolicy: 'wall-face',
          intersectionReferencePolicy: 'both-faces',
        }),
      ),
      centerline: buildLevelWallConstructionDimensionPlan(
        siblings,
        nodes,
        constructionDimensionStandard({ datumPolicy: 'centerline' }),
      ),
      'stud-faces': buildLevelWallConstructionDimensionPlan(
        siblings,
        nodes,
        constructionDimensionStandard({ datumPolicy: 'structural-face' }),
      ),
    },
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
  const { metricNotation, purpose, wallDimensionReference } = readFloorplanContext(ctx)
  const documentMode = purpose === 'document'
  const wallForPurpose = (wall: WallNode) =>
    documentMode ? wallWithModeledAssemblyThickness(wall) : exaggerateWallThickness(wall)
  const self = wallForPurpose(node)
  // Prefer the level-batch miter graph the floor-plan dispatcher precomputes
  // once per pass (`computeWallFloorplanLevelData`). Only the fallback path —
  // a direct builder caller with no shared data — pays the O(N) exaggerate +
  // level-wide miter calc per wall; the dispatcher path is O(1) here, which is
  // what keeps a wall drag from being O(N²) across the level.
  const levelData = ctx.levelData as WallFloorplanLevelData | undefined
  const miters =
    (documentMode ? levelData?.documentMiters : levelData?.miters) ??
    calculateLevelMiters([
      self,
      ...ctx.siblings.filter((s): s is AnyNode & WallNode => s.type === 'wall').map(wallForPurpose),
    ])

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
      strokeWidth: showSelectedChrome ? 0.03 : 0.02,
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

  children.push(...buildWallAssemblyFloorplanGraphics(self))

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

  // Selection hatch overlay — only when the wall is *the* selected item
  // (not when it's just marquee-highlighted), matching the legacy.
  if (isSelected && palette) {
    children.push({
      kind: 'hatch',
      points,
      color: palette.selectedHatch,
      opacity: 1,
    })
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

type WallAssemblyLayerSpan = {
  layer: WallAssemblyLayer
  interiorOffset: number
  exteriorOffset: number
}

function buildWallAssemblyFloorplanGraphics(wall: WallNode): FloorplanGeometry[] {
  if (isCurvedWall(wall)) return []

  const layers = wall.assemblyLayers ?? []
  if (layers.length === 0) return []

  const spans = getWallAssemblyLayerSpans(wall)
  if (spans.length === 0) return []

  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length <= 1e-6) return []

  const tx = dx / length
  const ty = dy / length
  const nx = -ty
  const ny = tx
  const startX = wall.start[0]
  const startY = wall.start[1]
  const endX = wall.end[0]
  const endY = wall.end[1]

  const graphics: FloorplanGeometry[] = []
  for (const span of spans) {
    const style = wallAssemblyLayerGraphicStyle(span.layer)
    const points = wallLayerPolygon(startX, startY, endX, endY, nx, ny, span)
    graphics.push({
      kind: 'polygon',
      points,
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      fillOpacity: style.fillOpacity,
      opacity: style.opacity,
      pointerEvents: 'none',
    })
    graphics.push(
      ...buildWallAssemblyLayerHatchLines({
        span,
        style,
        startX,
        startY,
        endX,
        endY,
        tx,
        ty,
        nx,
        ny,
        length,
      }),
    )
  }

  graphics.push(...buildWallAssemblyFaceLines(startX, startY, endX, endY, nx, ny, spans))
  return graphics
}

function getWallAssemblyLayerSpans(wall: WallNode): WallAssemblyLayerSpan[] {
  const layers = wall.assemblyLayers ?? []
  if (layers.length === 0) return []

  const coreLayers = layers.filter((layer) => layer.side === 'core')
  const coreThickness =
    coreLayers.length > 0
      ? coreLayers.reduce((sum, layer) => sum + layer.thickness, 0)
      : (wall.thickness ?? 0.1)
  const coreInteriorFace = -coreThickness / 2
  const coreExteriorFace = coreThickness / 2
  const spans: WallAssemblyLayerSpan[] = []

  let coreOffset = coreInteriorFace
  for (const layer of coreLayers) {
    const interiorOffset = coreOffset
    const exteriorOffset = coreOffset + layer.thickness
    spans.push({ layer, interiorOffset, exteriorOffset })
    coreOffset = exteriorOffset
  }

  let interiorOffset = coreInteriorFace
  for (const layer of layers.filter((candidate) => candidate.side === 'interior')) {
    const exteriorOffset = interiorOffset
    const nextInteriorOffset = exteriorOffset - layer.thickness
    spans.push({ layer, interiorOffset: nextInteriorOffset, exteriorOffset })
    interiorOffset = nextInteriorOffset
  }

  let exteriorOffset = coreExteriorFace
  for (const layer of layers.filter((candidate) => candidate.side === 'exterior')) {
    const interiorFaceOffset = exteriorOffset
    const nextExteriorOffset = interiorFaceOffset + layer.thickness
    spans.push({ layer, interiorOffset: interiorFaceOffset, exteriorOffset: nextExteriorOffset })
    exteriorOffset = nextExteriorOffset
  }

  return spans
}

type WallAssemblyLayerGraphicStyle = {
  fill: string
  stroke: string
  strokeWidth: number
  fillOpacity: number
  opacity?: number
  hatch?: 'diagonal' | 'cross' | 'brick' | 'air' | 'furring'
  hatchStroke: string
  hatchDasharray?: string
}

function wallAssemblyLayerGraphicStyle(layer: WallAssemblyLayer): WallAssemblyLayerGraphicStyle {
  switch (layer.role) {
    case 'structure':
      return {
        fill: '#475569',
        stroke: '#111827',
        strokeWidth: 0.006,
        fillOpacity: 0.34,
        hatch: 'diagonal',
        hatchStroke: '#0f172a',
      }
    case 'concrete-block':
    case 'structural-masonry':
      return {
        fill: '#cbd5e1',
        stroke: '#334155',
        strokeWidth: 0.006,
        fillOpacity: 0.82,
        hatch: 'cross',
        hatchStroke: '#475569',
      }
    case 'solid-concrete':
      return {
        fill: '#94a3b8',
        stroke: '#334155',
        strokeWidth: 0.006,
        fillOpacity: 0.78,
        hatch: 'diagonal',
        hatchStroke: '#64748b',
      }
    case 'masonry-veneer':
      return {
        fill: '#fca5a5',
        stroke: '#7f1d1d',
        strokeWidth: 0.004,
        fillOpacity: 0.45,
        hatch: 'brick',
        hatchStroke: '#991b1b',
      }
    case 'air-space':
      return {
        fill: '#ffffff',
        stroke: '#94a3b8',
        strokeWidth: 0.004,
        fillOpacity: 0.15,
        hatch: 'air',
        hatchStroke: '#64748b',
        hatchDasharray: '0.035 0.025',
      }
    case 'furring':
      return {
        fill: '#fde68a',
        stroke: '#92400e',
        strokeWidth: 0.004,
        fillOpacity: 0.42,
        hatch: 'furring',
        hatchStroke: '#92400e',
        hatchDasharray: '0.04 0.02',
      }
    case 'interior-finish':
    case 'exterior-finish':
    case 'exterior-sheathing':
      return {
        fill: '#f8fafc',
        stroke: '#94a3b8',
        strokeWidth: 0.003,
        fillOpacity: 0.72,
        hatch: layer.role === 'exterior-sheathing' ? 'diagonal' : undefined,
        hatchStroke: '#94a3b8',
      }
  }
}

function wallLayerPolygon(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  nx: number,
  ny: number,
  span: WallAssemblyLayerSpan,
): FloorplanPoint[] {
  return [
    [startX + nx * span.interiorOffset, startY + ny * span.interiorOffset],
    [endX + nx * span.interiorOffset, endY + ny * span.interiorOffset],
    [endX + nx * span.exteriorOffset, endY + ny * span.exteriorOffset],
    [startX + nx * span.exteriorOffset, startY + ny * span.exteriorOffset],
  ]
}

function buildWallAssemblyLayerHatchLines({
  span,
  style,
  startX,
  startY,
  tx,
  ty,
  nx,
  ny,
  length,
}: {
  span: WallAssemblyLayerSpan
  style: WallAssemblyLayerGraphicStyle
  startX: number
  startY: number
  endX: number
  endY: number
  tx: number
  ty: number
  nx: number
  ny: number
  length: number
}): FloorplanGeometry[] {
  if (!style.hatch) return []

  const layerWidth = span.exteriorOffset - span.interiorOffset
  if (layerWidth <= 1e-6) return []

  const interval = Math.max(FLOORPLAN_ASSEMBLY_GRAPHIC_MIN_SPACING, layerWidth * 1.8)
  const insetAlong = Math.min(0.035, length * 0.08)
  const lines: FloorplanGeometry[] = []

  if (style.hatch === 'air') {
    const midOffset = (span.interiorOffset + span.exteriorOffset) / 2
    lines.push(
      wallAssemblyLine(
        startX + tx * insetAlong,
        startY + ty * insetAlong,
        startX + tx * (length - insetAlong),
        startY + ty * (length - insetAlong),
        nx,
        ny,
        midOffset,
        style.hatchStroke,
        style.hatchDasharray,
      ),
    )
    return lines
  }

  if (style.hatch === 'brick') {
    for (let along = interval; along < length; along += interval) {
      lines.push(
        wallCrossLine(startX, startY, tx, ty, nx, ny, along, span, style.hatchStroke, undefined),
      )
    }
    const thirds = [
      span.interiorOffset + layerWidth / 3,
      span.interiorOffset + (layerWidth * 2) / 3,
    ]
    for (const offset of thirds) {
      lines.push(
        wallAssemblyLine(
          startX + tx * insetAlong,
          startY + ty * insetAlong,
          startX + tx * (length - insetAlong),
          startY + ty * (length - insetAlong),
          nx,
          ny,
          offset,
          style.hatchStroke,
          style.hatchDasharray,
        ),
      )
    }
    return lines
  }

  if (style.hatch === 'furring') {
    for (let along = interval; along < length; along += interval) {
      lines.push(
        wallCrossLine(
          startX,
          startY,
          tx,
          ty,
          nx,
          ny,
          along,
          span,
          style.hatchStroke,
          style.hatchDasharray,
        ),
      )
    }
    return lines
  }

  const emitDiagonal = (flip: boolean) => {
    for (let along = interval / 2; along < length; along += interval) {
      const centerOffset = (span.interiorOffset + span.exteriorOffset) / 2
      const halfAlong = Math.min(interval * 0.35, length * 0.08)
      const halfAcross = layerWidth * 0.42
      const sign = flip ? -1 : 1
      lines.push({
        kind: 'line',
        x1: startX + tx * Math.max(0, along - halfAlong) + nx * (centerOffset - sign * halfAcross),
        y1: startY + ty * Math.max(0, along - halfAlong) + ny * (centerOffset - sign * halfAcross),
        x2:
          startX +
          tx * Math.min(length, along + halfAlong) +
          nx * (centerOffset + sign * halfAcross),
        y2:
          startY +
          ty * Math.min(length, along + halfAlong) +
          ny * (centerOffset + sign * halfAcross),
        stroke: style.hatchStroke,
        strokeWidth: 0.55,
        strokeDasharray: style.hatchDasharray,
        vectorEffect: 'non-scaling-stroke',
        pointerEvents: 'none',
      })
    }
  }

  emitDiagonal(false)
  if (style.hatch === 'cross') emitDiagonal(true)
  return lines
}

function wallAssemblyLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  nx: number,
  ny: number,
  offset: number,
  stroke: string,
  strokeDasharray: string | undefined,
): FloorplanGeometry {
  return {
    kind: 'line',
    x1: x1 + nx * offset,
    y1: y1 + ny * offset,
    x2: x2 + nx * offset,
    y2: y2 + ny * offset,
    stroke,
    strokeWidth: 0.5,
    strokeDasharray,
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'none',
  }
}

function wallCrossLine(
  startX: number,
  startY: number,
  tx: number,
  ty: number,
  nx: number,
  ny: number,
  along: number,
  span: WallAssemblyLayerSpan,
  stroke: string,
  strokeDasharray: string | undefined,
): FloorplanGeometry {
  return {
    kind: 'line',
    x1: startX + tx * along + nx * span.interiorOffset,
    y1: startY + ty * along + ny * span.interiorOffset,
    x2: startX + tx * along + nx * span.exteriorOffset,
    y2: startY + ty * along + ny * span.exteriorOffset,
    stroke,
    strokeWidth: 0.5,
    strokeDasharray,
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'none',
  }
}

function buildWallAssemblyFaceLines(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  nx: number,
  ny: number,
  spans: WallAssemblyLayerSpan[],
): FloorplanGeometry[] {
  const offsets = new Set<number>()
  for (const span of spans) {
    offsets.add(span.interiorOffset)
    offsets.add(span.exteriorOffset)
  }

  const sortedOffsets = [...offsets].sort((a, b) => a - b)
  const minOffset = sortedOffsets[0]
  const maxOffset = sortedOffsets.at(-1)

  return sortedOffsets.map((offset) => ({
    kind: 'line',
    x1: startX + nx * offset,
    y1: startY + ny * offset,
    x2: endX + nx * offset,
    y2: endY + ny * offset,
    stroke: offset === minOffset || offset === maxOffset ? '#111827' : '#64748b',
    strokeWidth: offset === minOffset || offset === maxOffset ? 0.85 : 0.45,
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'none',
  }))
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
