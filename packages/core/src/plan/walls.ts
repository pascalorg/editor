import type { WallNode } from '../schema'

const FLOORPLAN_WALL_THICKNESS_SCALE = 1.18
const FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS = 0.13
const FLOORPLAN_MAX_EXTRA_THICKNESS = 0.035

export function getFloorplanWallThickness(wall: WallNode): number {
  const baseThickness = wall.thickness ?? 0.1
  const scaledThickness = baseThickness * FLOORPLAN_WALL_THICKNESS_SCALE

  return Math.min(
    baseThickness + FLOORPLAN_MAX_EXTRA_THICKNESS,
    Math.max(baseThickness, scaledThickness, FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS),
  )
}

export function getFloorplanWall(wall: WallNode): WallNode {
  return {
    ...wall,
    // Slightly exaggerate thin walls so the 2D plan stays legible without drifting from BIM data.
    thickness: getFloorplanWallThickness(wall),
  }
}
