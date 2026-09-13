import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { type ElevationMarkerNode, elevationMarkerAngle } from '../schema'

const INK = '#111111'
const RADIUS = 0.36
const ARROW_LENGTH = 0.34
const ARROW_HALF_WIDTH = 0.16

/**
 * The plan symbol: a bubble with the elevation number, a solid arrowhead
 * pointing the way the elevation looks, and the compass label under it.
 */
export function buildElevationMarkerFloorplan(
  node: ElevationMarkerNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const angle = elevationMarkerAngle(node)
  // Plan space is (x right, z down) and the azimuth is measured from +x
  // toward +z, so the look vector is (cos, sin) with no sign flip.
  const look: FloorplanPoint = [Math.cos(angle), Math.sin(angle)]
  const across: FloorplanPoint = [-look[1], look[0]]
  const cx = node.position[0]
  const cz = node.position[1]

  const view = ctx.viewState
  const selected = (view?.selected ?? false) || (view?.highlighted ?? false)
  const stroke = selected && view?.palette ? view.palette.selectedStroke : INK

  const tip: FloorplanPoint = [
    cx + look[0] * (RADIUS + ARROW_LENGTH),
    cz + look[1] * (RADIUS + ARROW_LENGTH),
  ]
  const back: FloorplanPoint = [cx + look[0] * RADIUS, cz + look[1] * RADIUS]

  return {
    kind: 'group',
    children: [
      {
        kind: 'circle',
        cx,
        cy: cz,
        r: RADIUS,
        fill: '#ffffff',
        stroke,
        strokeWidth: 0.02,
        pointerEvents: 'all',
      },
      {
        kind: 'polygon',
        points: [
          tip,
          [back[0] + across[0] * ARROW_HALF_WIDTH, back[1] + across[1] * ARROW_HALF_WIDTH],
          [back[0] - across[0] * ARROW_HALF_WIDTH, back[1] - across[1] * ARROW_HALF_WIDTH],
        ],
        fill: stroke,
        stroke,
        strokeWidth: 0.006,
      },
      {
        kind: 'text',
        x: cx,
        y: cz + 0.07,
        text: node.label || '1',
        fontSize: 0.24,
        fill: stroke,
        fontWeight: 600,
        textAnchor: 'middle',
        dominantBaseline: 'alphabetic',
        upright: true,
      },
      {
        kind: 'text',
        x: cx,
        y: cz + RADIUS + 0.28,
        text:
          node.direction === 'custom'
            ? `${Math.round((angle * 180) / Math.PI)}°`
            : node.direction.toUpperCase(),
        fontSize: 0.15,
        fill: stroke,
        textAnchor: 'middle',
        dominantBaseline: 'alphabetic',
        upright: true,
      },
    ],
  }
}
