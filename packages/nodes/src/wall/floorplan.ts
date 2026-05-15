import {
  type AnyNode,
  calculateLevelMiters,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallPlanFootprint,
  type WallNode,
} from '@pascal-app/core'

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

/**
 * Stage C floor-plan builder for wall. Returns the mitered plan
 * footprint polygon. Uses `ctx.siblings` to gather other walls in the
 * level so `calculateLevelMiters` produces the correct corner joins.
 *
 * Performance note: this recomputes level miter data per wall (O(N²)
 * across N walls in the level). For < 100 walls per level this is
 * sub-millisecond. If a real perf hotspot surfaces, the `ctx.levelData?.
 * miters` extension flagged in the plan moves the batch computation to
 * the dispatcher.
 */
export function buildWallFloorplan(node: WallNode, ctx: GeometryContext): FloorplanGeometry | null {
  const siblings = ctx.siblings.filter((s): s is AnyNode & WallNode => s.type === 'wall')
  const all = [node, ...siblings].map(exaggerateWallThickness)
  const miters = calculateLevelMiters(all)
  const self = all.find((w) => w.id === node.id)
  if (!self) return null

  const polygon = getWallPlanFootprint(self, miters)
  if (!polygon || polygon.length < 3) return null

  return {
    kind: 'polygon',
    points: polygon.map((p) => [p.x, p.y] as FloorplanPoint),
    fill: '#374151',
    stroke: '#1f2937',
    strokeWidth: 0.02,
    opacity: 0.92,
  }
}
