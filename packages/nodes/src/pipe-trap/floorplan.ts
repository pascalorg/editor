import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { getPipeTrapPorts } from './ports'
import type { PipeTrapNode } from './schema'

const PIPE_STROKE = '#57534e'

/**
 * Floor-plan symbol — the conventional trap glyph: a short stub at the
 * inlet (the fixture drop, drawn as a dot since it's vertical) and a
 * solid line for the trap arm out to the outlet. Reads as the P-trap's
 * arm in plan.
 */
export function buildPipeTrapFloorplan(
  node: PipeTrapNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const ports = getPipeTrapPorts(node)
  const inlet = ports.find((p) => p.id === 'inlet')!
  const outlet = ports.find((p) => p.id === 'outlet')!

  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : PIPE_STROKE

  const inletXZ: FloorplanPoint = [inlet.position[0], inlet.position[2]]
  const outletXZ: FloorplanPoint = [outlet.position[0], outlet.position[2]]

  const children: FloorplanGeometry[] = [
    {
      kind: 'polyline',
      points: [inletXZ, outletXZ],
      stroke,
      strokeWidth: showSelectedChrome ? 2.5 : 1.8,
      vectorEffect: 'non-scaling-stroke',
      opacity: 0.9,
    },
    {
      kind: 'circle',
      cx: inletXZ[0],
      cy: inletXZ[1],
      r: 0.04,
      fill: stroke,
      opacity: 0.9,
    },
  ]

  if (showSelectedChrome) {
    children.push({ kind: 'move-handle', point: [node.position[0], node.position[2]] })
  }

  return { kind: 'group', children }
}
