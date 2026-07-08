import type { FloorplanAffordancePoint } from '@pascal-app/core'

/**
 * Convert client (screen) coordinates into floor-plan plan coordinates via
 * the mounted floor-plan scene `<g>`'s screen CTM. The scene `<g>` maps plan
 * X/Z directly to SVG x/y (Z stored as the Y axis on screen — same convention
 * as `toSvgPlanPoint`), so the returned point is in the same level-frame
 * meters node placements use. Null when no floor plan is mounted.
 */
export function clientToPlan(clientX: number, clientY: number): FloorplanAffordancePoint | null {
  const target = document.querySelector('g[data-floorplan-scene]') as SVGGElement | null
  const svg = target?.ownerSVGElement
  if (!(svg && target)) return null
  const ctm = target.getScreenCTM()
  if (!ctm) return null
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const transformed = point.matrixTransform(ctm.inverse())
  return [transformed.x, transformed.y]
}
