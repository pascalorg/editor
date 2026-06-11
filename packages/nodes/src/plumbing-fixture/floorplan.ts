import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { getPlumbingFixturePorts } from './ports'
import type { PlumbingFixtureNode } from './schema'
import { FIXTURE_SPECS } from './spec'

const BODY_FILL = '#f5f5f4'
const BODY_STROKE = '#78716c'
const DRAIN_COLOR = '#57534e'

/**
 * Floor-plan symbol: the fixture's footprint rectangle (rotated by yaw)
 * with a drain dot at the rough-in point. Toilets additionally get the
 * conventional bowl ellipse so they read instantly.
 */
export function buildPlumbingFixtureFloorplan(
  node: PlumbingFixtureNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const [cx, , cz] = node.position
  const spec = FIXTURE_SPECS[node.fixtureType]
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  const hw = spec.size[0] / 2
  const hd = spec.size[2] / 2
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

  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : BODY_STROKE

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill: BODY_FILL,
      stroke,
      strokeWidth: showSelectedChrome ? 0.025 : 0.015,
      opacity: 0.95,
    },
  ]

  if (node.fixtureType === 'toilet') {
    const bowl = corner(0, 0.08)
    children.push({
      kind: 'circle',
      cx: bowl[0],
      cy: bowl[1],
      r: 0.16,
      fill: 'none',
      stroke,
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
      opacity: 0.9,
    })
  }

  const drain = getPlumbingFixturePorts(node)[0]!
  children.push({
    kind: 'circle',
    cx: drain.position[0],
    cy: drain.position[2],
    r: 0.035,
    fill: DRAIN_COLOR,
    opacity: 0.9,
  })

  if (showSelectedChrome) children.push({ kind: 'move-handle', point: [cx, cz] })

  return { kind: 'group', children }
}
