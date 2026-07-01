import type { CabinetNode, FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'

const BODY_FILL = '#ddd6c8'
const BODY_STROKE = '#7c7468'

export function buildCabinetFloorplan(
  node: CabinetNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const [cx, , cz] = node.position
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  const hw = node.width / 2
  const hd = node.depth / 2
  const corner = (lx: number, lz: number): FloorplanPoint => [
    cx + lx * cos + lz * sin,
    cz - lx * sin + lz * cos,
  ]
  const points: FloorplanPoint[] = [
    corner(-hw, -hd),
    corner(hw, -hd),
    corner(hw, hd),
    corner(-hw, hd),
  ]
  const frontLeft = corner(-hw * 0.7, hd * 0.82)
  const frontRight = corner(hw * 0.7, hd * 0.82)
  const showSelectedChrome = (ctx.viewState?.selected || ctx.viewState?.highlighted) ?? false
  const stroke =
    showSelectedChrome && ctx.viewState?.palette ? ctx.viewState.palette.selectedStroke : BODY_STROKE

  return {
    kind: 'group',
    children: [
      {
        kind: 'polygon',
        points,
        fill: BODY_FILL,
        stroke,
        strokeWidth: showSelectedChrome ? 0.03 : 0.02,
        opacity: 0.95,
      },
      {
        kind: 'line',
        x1: frontLeft[0],
        y1: frontLeft[1],
        x2: frontRight[0],
        y2: frontRight[1],
        stroke,
        strokeWidth: 1,
        vectorEffect: 'non-scaling-stroke',
        opacity: 0.8,
      },
      ...(showSelectedChrome
        ? [{ kind: 'move-handle' as const, point: [cx, cz] as [number, number] }]
        : []),
    ],
  }
}
