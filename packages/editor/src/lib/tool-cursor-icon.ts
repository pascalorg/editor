import { type IconRef, type MessageDescriptor, nodeRegistry } from '@pascal-app/core'
import type { ContinuationMode } from './continuation'
import { nodeKindHudTitle } from './hud-title'
import { getWallDrawVariantInfo, wallDrawVariantOf } from './wall-draw-variant'

/**
 * The cursor bubble's icon for the wall tool: the Rooms variant in hand
 * (Rectangle / Polygon / Walls), the same art as the Build panel tile.
 */
export function wallCursorIcon(mode: ContinuationMode): {
  label: MessageDescriptor
  iconSrc: string
} {
  const variant = getWallDrawVariantInfo(wallDrawVariantOf(mode))
  return { label: variant.title, iconSrc: variant.iconSrc }
}

/** The registry icon a tool flagged with `presentation.cursorIcon` shows in the 3D cursor bubble and the plan's cursor badge. */
export function registryToolCursorIcon(
  tool: string,
): { label: MessageDescriptor; icon: IconRef } | null {
  if (!nodeRegistry.get(tool)?.presentation?.cursorIcon) return null
  const title = nodeKindHudTitle(tool)
  return title?.icon ? { label: title.label, icon: title.icon } : null
}
