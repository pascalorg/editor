import {
  type FloorplanGeometry,
  type GeometryContext,
  type RampNode,
  rampStations,
} from '@pascal-app/core'

export function buildRampFloorplan(node: RampNode, ctx: GeometryContext): FloorplanGeometry | null {
  const stations = rampStations(node)
  if (stations.length < 2) return null
  const left = stations.map(
    ({ point, tangent }) =>
      [point[0] - (tangent[1] * node.width) / 2, point[1] + (tangent[0] * node.width) / 2] as [
        number,
        number,
      ],
  )
  const right = stations.map(
    ({ point, tangent }) =>
      [point[0] + (tangent[1] * node.width) / 2, point[1] - (tangent[0] * node.width) / 2] as [
        number,
        number,
      ],
  )
  const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke = selected ? (ctx.viewState?.palette.selectedStroke ?? '#0ea5e9') : '#73716c'
  const middle = stations[Math.floor(stations.length / 2)]
  const first = stations[0]
  const last = stations.at(-1)
  if (!middle || !first || !last) return null
  const arrowSign = node.endHeight >= node.startHeight ? 1 : -1
  const [tx, tz] = middle.tangent
  const [x, z] = middle.point
  const tip: [number, number] = [x + tx * arrowSign * 0.6, z + tz * arrowSign * 0.6]
  return {
    kind: 'group',
    children: [
      {
        kind: 'polygon',
        points: [...left, ...right.slice().reverse()],
        fill: selected ? (ctx.viewState?.palette.selectedFill ?? '#dbeafe') : '#d6d3cd',
        fillOpacity: 0.55,
        stroke,
        strokeWidth: 1.2,
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'polyline',
        points: stations.map((station) => station.point),
        fill: 'none',
        stroke,
        strokeWidth: 1,
        strokeDasharray: '5 4',
        vectorEffect: 'non-scaling-stroke',
        pointerEvents: 'none',
      },
      {
        kind: 'line',
        x1: x - tx * arrowSign * 0.6,
        y1: z - tz * arrowSign * 0.6,
        x2: tip[0],
        y2: tip[1],
        stroke,
        strokeWidth: 1.5,
        vectorEffect: 'non-scaling-stroke',
        pointerEvents: 'none',
      },
      {
        kind: 'polyline',
        points: [
          [tip[0] - tx * arrowSign * 0.25 - tz * 0.18, tip[1] - tz * arrowSign * 0.25 + tx * 0.18],
          tip,
          [tip[0] - tx * arrowSign * 0.25 + tz * 0.18, tip[1] - tz * arrowSign * 0.25 - tx * 0.18],
        ],
        fill: 'none',
        stroke,
        strokeWidth: 1.5,
        vectorEffect: 'non-scaling-stroke',
        pointerEvents: 'none',
      },
      ...[first, last].map(
        (station): FloorplanGeometry => ({
          kind: 'text',
          x: station.point[0],
          y: station.point[1],
          text: `${station.height.toFixed(2)} m`,
          fontSize: 0.18,
          fill: stroke,
          textAnchor: 'middle',
          dominantBaseline: 'hanging',
          upright: true,
        }),
      ),
    ],
  }
}
