import {
  type AnyNode,
  calculateLevelMiters,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallCurveLength,
  getWallMidpointHandlePoint,
  getWallPlanFootprint,
  isCurvedWall,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import {
  buildLevelWallConstructionDimensionPlan,
  buildWallConstructionDimensions,
  formatConstructionLength,
  renderPlannedConstructionDimensions,
  type WallConstructionDimensionPlan,
} from './construction-dimensions'

// Same constants the legacy `getFloorplanWall` uses (editor/lib/floorplan/walls.ts).
// Slightly exaggerates thin walls so the 2D plan stays legible without
// drifting from BIM data. Inlined to keep nodes/wall self-contained.
const FLOORPLAN_WALL_THICKNESS_SCALE = 1.18
const FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS = 0.13
const FLOORPLAN_MAX_EXTRA_THICKNESS = 0.035

function floorplanWallThickness(wall: WallNode): number {
  const baseThickness = wall.thickness ?? 0.1
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
  constructionDimensionsByWallId: WallConstructionDimensionPlan
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
    constructionDimensionsByWallId: buildLevelWallConstructionDimensionPlan(siblings, nodes),
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
  const self = exaggerateWallThickness(node)
  // Prefer the level-batch miter graph the floor-plan dispatcher precomputes
  // once per pass (`computeWallFloorplanLevelData`). Only the fallback path —
  // a direct builder caller with no shared data — pays the O(N) exaggerate +
  // level-wide miter calc per wall; the dispatcher path is O(1) here, which is
  // what keeps a wall drag from being O(N²) across the level.
  const levelData = ctx.levelData as WallFloorplanLevelData | undefined
  const miters =
    levelData?.miters ??
    calculateLevelMiters([
      self,
      ...ctx.siblings
        .filter((s): s is AnyNode & WallNode => s.type === 'wall')
        .map(exaggerateWallThickness),
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
      // Once the wall is selected, the body keeps catching the pointer
      // so the cursor stays neutral (no drag/pointer affordance from
      // the slab below leaking through), but only the side-arrows and
      // endpoint handles should start a drag — the wrapper g's click
      // handler is a no-op re-select for the already-selected wall.
      cursor: isSelected ? 'default' : undefined,
    },
  ]

  if (!isCurvedWall(node)) {
    const planned = levelData?.constructionDimensionsByWallId.get(node.id)
    const dimensionStroke =
      isSelected && palette ? palette.selectedStroke : (palette?.measurementStroke ?? '#334155')
    if (planned) {
      children.push(
        ...renderPlannedConstructionDimensions(planned, view?.unit ?? 'metric', dimensionStroke),
      )
    } else if (!levelData) {
      children.push(
        ...buildWallConstructionDimensions(self, ctx, {
          unit: view?.unit ?? 'metric',
          stroke: dimensionStroke,
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
        const midX = (node.start[0] + node.end[0]) / 2
        const midZ = (node.start[1] + node.end[1]) / 2
        const nx = -dz / wallLength
        const nz = dx / wallLength
        const offset = floorplanWallThickness(node) / 2 + 0.05
        children.push({
          kind: 'move-arrow',
          point: [midX + nx * offset, midZ + nz * offset],
          angle: Math.atan2(nz, nx),
        })
        children.push({
          kind: 'move-arrow',
          point: [midX - nx * offset, midZ - nz * offset],
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

    // Curved walls cannot express their arc length through a straight
    // construction string, so selection keeps the compact arc-length label.
    const length = getWallCurveLength(node)
    if (length >= 0.1 && isCurvedWall(node)) {
      const dx = node.end[0] - node.start[0]
      const dz = node.end[1] - node.start[1]
      const midX = (node.start[0] + node.end[0]) / 2
      const midZ = (node.start[1] + node.end[1]) / 2
      children.push({
        kind: 'dimension-label',
        cx: midX,
        cy: midZ,
        text: formatConstructionLength(length, view?.unit ?? 'metric'),
        angle: Math.atan2(dz, dx),
      })
    }
  }

  return { kind: 'group', children }
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
