import {
  type FloorplanGeometry,
  type GeometryContext,
  type HedgeNode,
  hedgeBands,
  hedgeLine,
} from '@pascal-app/core'

const ring = (points: [number, number][]) =>
  `M${points.map(([x, z]) => `${+x.toFixed(3)} ${+z.toFixed(3)}`).join('L')}Z`

/**
 * The hedge on the plan: the band of ground it covers along its line, one band a planted run, so
 * an opening shows as a break in it. Leaf green; the selection's colours while it is marked.
 */
export function buildHedgeFloorplan(
  node: HedgeNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const bands = hedgeBands(hedgeLine(node), node.width)
  if (!bands.length) return null
  const view = ctx.viewState
  const marked = (view?.selected ?? false) || (view?.highlighted ?? false)
  const body: FloorplanGeometry = {
    kind: 'path',
    d: bands.map((rings) => rings.map(ring).join('')).join(''),
    fillRule: 'evenodd',
    fill: marked ? (view?.palette?.selectedFill ?? '#dbeafe') : '#7fae5f',
    fillOpacity: 0.75,
    stroke: marked ? (view?.palette?.selectedStroke ?? '#0ea5e9') : '#3f6b2c',
    strokeWidth: 1.2,
    vectorEffect: 'non-scaling-stroke',
    strokeLinejoin: 'round',
  }
  return body
}
