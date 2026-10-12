import type { FloorplanGeometry, GeometryContext, PanelNode, WallNode } from '@pascal-app/core'
import { panelDepthOffset } from '@pascal-app/core'

/** A thin strip standing off the wall face, where the panel sits in plan. */
export function buildPanelFloorplan(
  node: PanelNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const wall = ctx.parent as WallNode | null
  if (wall?.type !== 'wall') return null
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return null
  const dir = [dx / length, dz / length] as const
  // The wall's front (local +Z) is the left normal of its start → end direction.
  const normal = [-dir[1], dir[0]] as const
  const centre = panelDepthOffset(node, wall)
  const near = centre - node.thickness / 2
  const far = centre + node.thickness / 2
  const point = (along: number, out: number): [number, number] => [
    wall.start[0] + dir[0] * along + normal[0] * out,
    wall.start[1] + dir[1] * along + normal[1] * out,
  ]
  const left = node.position[0] - node.width / 2
  const right = node.position[0] + node.width / 2
  const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
  return {
    kind: 'polygon',
    points: [point(left, near), point(right, near), point(right, far), point(left, far)],
    fill: selected ? '#fed7aa' : 'rgba(71, 85, 105, 0.55)',
    stroke: selected ? '#f97316' : 'rgba(31, 41, 55, 0.9)',
    strokeWidth: selected ? 1.6 : 1,
    vectorEffect: 'non-scaling-stroke',
    strokeLinejoin: 'round',
  }
}
