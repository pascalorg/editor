import type { IconRef, MessageDescriptor } from '@pascal-app/core'
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

/**
 * Tools whose cursor bubble shows their kind's own registry icon and name (what
 * the helper panel's header shows for them): the garden kinds placed by hand.
 * The other build tools carry bitmap art in `structure-tools.ts`.
 */
const REGISTRY_ICON_TOOLS: ReadonlySet<string> = new Set([
  'tree',
  'rock',
  'hedge',
  'planting',
  'lawn',
])

/** The registry icon a listed tool shows in the 3D cursor bubble and the plan's cursor badge. */
export function registryToolCursorIcon(
  tool: string,
): { label: MessageDescriptor; icon: IconRef } | null {
  if (!REGISTRY_ICON_TOOLS.has(tool)) return null
  const title = nodeKindHudTitle(tool)
  return title?.icon ? { label: title.label, icon: title.icon } : null
}
