import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import { getDuctFittingPorts } from './ports'
import type { DuctFittingNode } from './schema'

const SUPPLY_COLOR = '#d4825a'
const RETURN_COLOR = '#5a8ad4'
const BODY_COLOR = '#9ca3af'

/**
 * Floor-plan symbol for a duct fitting: one stub line per port from the
 * junction center out to the collar (drawn at each collar's real
 * diameter), plus a junction circle. Ports are computed in level-local
 * 3D and projected to plan, so a rotated or riser-turned fitting shows
 * its true plan footprint; a vertical port collapses onto the junction
 * circle, which is exactly how it should read from above.
 */
export function buildDuctFittingFloorplan(
  node: DuctFittingNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const [cx, , cz] = node.position
  const ports = getDuctFittingPorts(node)
  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const accent = node.system === 'supply' ? SUPPLY_COLOR : RETURN_COLOR
  const bodyStroke = showSelectedChrome && palette ? palette.selectedStroke : BODY_COLOR

  const children: FloorplanGeometry[] = []
  for (const port of ports) {
    const px = port.position[0]
    const pz = port.position[2]
    // Vertical port — projects onto the junction itself; skip the stub.
    if (Math.hypot(px - cx, pz - cz) < 1e-4) continue
    children.push({
      kind: 'line',
      x1: cx,
      y1: cz,
      x2: px,
      y2: pz,
      stroke: bodyStroke,
      strokeWidth: port.diameter * INCHES_TO_METERS,
      strokeLinecap: 'round',
      opacity: showSelectedChrome ? 0.95 : 0.8,
    })
  }

  children.push({
    kind: 'circle',
    cx,
    cy: cz,
    r: (node.diameter * INCHES_TO_METERS) / 2 + 0.015,
    fill: bodyStroke,
    stroke: accent,
    strokeWidth: 1.5,
    vectorEffect: 'non-scaling-stroke',
    opacity: 0.95,
  })

  if (showSelectedChrome) {
    children.push({
      kind: 'move-handle',
      point: [cx, cz],
    })
  }

  return { kind: 'group', children }
}
