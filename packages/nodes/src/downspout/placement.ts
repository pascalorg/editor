import type { GutterNode } from '@pascal-app/core'
import { resolveGutterOutletById } from '../gutter/outlet-lookup'

/** Convert a point on the rendered arc back to distance along the unbent run. */
export function downspoutCursorOffset(gutter: GutterNode, x: number, z: number): number {
  if (!gutter.arc || !(gutter.arc.radius > 0)) return x
  const { centerX, centerZ, radius } = gutter.arc
  const sign = Math.sign(centerZ) || 1
  const angle = Math.atan2((x - centerX) * sign, (centerZ - z) * sign)
  return centerX + angle * radius * sign
}

export function resolveDownspoutPlacement(
  gutter: GutterNode,
  raw: number,
  step = 0,
  force = false,
) {
  const diameter = 0.07
  const offset = !force && step > 0 ? Math.round(raw / step) * step : raw
  const ghost = { ...gutter, arc: undefined, outlets: [{ id: 'preview', offset, diameter }] }
  const outlet = resolveGutterOutletById(ghost, 'preview')
  if (!outlet) return null
  const finalOffset = outlet.x
  const valid =
    force ||
    !(gutter.outlets ?? []).some((existing) => {
      const placement = resolveGutterOutletById({ ...gutter, arc: undefined }, existing.id)
      return (
        placement &&
        Math.abs(placement.x - finalOffset) < placement.innerHalfX + outlet.innerHalfX + 0.02
      )
    })
  return { offset: finalOffset, diameter, valid }
}
