import { useFloorRegionDraft } from './floor-region-session'
import { type PaintMode, paintRegionTargets, usePaintRegionMode } from './paint-region-mode'
import { useWallPaintRegionSession } from './wall-paint-region-session'

/** Whether a region sub-mode draws on what the pointer is over. */
export function paintRegionHovering(
  mode: PaintMode,
  over: { wall: boolean; floor: boolean },
): boolean {
  const targets = paintRegionTargets(mode)
  return (targets.wall && over.wall) || (targets.floor && over.floor)
}

/**
 * Whether the pointer is over a surface the active region sub-mode draws on —
 * a wall face (Rectangle) or a room floor — or a region is being drawn. The
 * paint cursor and the HUD read it: region modes stand the whole-surface hover
 * down, so its "nothing paintable here" never speaks for them.
 */
export function usePaintRegionHovering(): boolean {
  const mode = usePaintRegionMode((state) => state.mode)
  const wall = useWallPaintRegionSession((state) => state.preview !== null)
  const floor = useFloorRegionDraft((state) => state.hover !== null || state.draft !== null)
  return paintRegionHovering(mode, { wall, floor })
}
