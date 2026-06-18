import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import { getPipeFittingPorts } from './ports'
import type { PipeFittingNode } from './schema'

const WASTE_COLOR = '#57534e'
const VENT_COLOR = '#78716c'

/**
 * Floor-plan symbol for a DWV fitting: one line per collar from the
 * junction out (a wye's 45° branch reads at its true plan angle), plus
 * a hub circle. Vertical collars (stack connections) collapse onto the
 * hub, which is how they should read from above.
 */
export function buildPipeFittingFloorplan(
  node: PipeFittingNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const [cx, , cz] = node.position
  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : node.system === 'vent'
        ? VENT_COLOR
        : WASTE_COLOR

  const children: FloorplanGeometry[] = []
  for (const port of getPipeFittingPorts(node)) {
    const px = port.position[0]
    const pz = port.position[2]
    if (Math.hypot(px - cx, pz - cz) < 1e-4) continue
    children.push({
      kind: 'line',
      x1: cx,
      y1: cz,
      x2: px,
      y2: pz,
      stroke,
      strokeWidth: port.diameter * INCHES_TO_METERS,
      strokeLinecap: 'round',
      opacity: showSelectedChrome ? 0.95 : 0.85,
    })
  }
  children.push({
    kind: 'circle',
    cx,
    cy: cz,
    r: (node.diameter * INCHES_TO_METERS) / 2 + 0.012,
    fill: stroke,
    opacity: 0.95,
  })
  if (showSelectedChrome) children.push({ kind: 'move-handle', point: [cx, cz] })

  return { kind: 'group', children }
}
