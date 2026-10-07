import type { ContinuationMode } from './continuation'
import { getWallDrawVariantInfo, wallDrawVariantOf } from './wall-draw-variant'

/**
 * The cursor bubble's icon for the wall tool: the Rooms variant in hand
 * (Rectangle / Polygon / Walls), the same art as the Build panel tile.
 */
export function wallCursorIcon(mode: ContinuationMode): { label: string; iconSrc: string } {
  const variant = getWallDrawVariantInfo(wallDrawVariantOf(mode))
  return { label: variant.title, iconSrc: variant.iconSrc }
}
