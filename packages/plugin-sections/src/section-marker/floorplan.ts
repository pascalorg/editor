import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import type { SectionMarkerNode } from '../schema'

const INK = '#111111'
const BUBBLE_RADIUS = 0.34
const TAIL_LENGTH = 0.55
const ARROW_LENGTH = 0.26
const ARROW_HALF_WIDTH = 0.1
/** Fraction of the run left blank in the middle — the standard broken cut line. */
const BREAK_FRACTION = 0.34

/**
 * The plan symbol: a heavy broken cut line with a bubble + look-direction
 * arrow at each end, plus draggable endpoint handles.
 *
 * Plan space is world [x, z] metres, the same space walls draw in.
 */
export function buildSectionMarkerFloorplan(
  node: SectionMarkerNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const start: FloorplanPoint = [node.start[0], node.start[1]]
  const end: FloorplanPoint = [node.end[0], node.end[1]]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null
  const axis: FloorplanPoint = [dx / length, dz / length]
  // Screen-left of travel with x right and z down is (a.z, -a.x).
  const look: FloorplanPoint =
    node.lookDirection === 'left' ? [axis[1], -axis[0]] : [-axis[1], axis[0]]

  const view = ctx.viewState
  const selected = (view?.selected ?? false) || (view?.highlighted ?? false)
  const stroke = selected && view?.palette ? view.palette.selectedStroke : INK

  const at = (t: number): FloorplanPoint => [start[0] + dx * t, start[1] + dz * t]
  const runIn = (1 - BREAK_FRACTION) / 2
  const children: FloorplanGeometry[] = [
    {
      kind: 'hit-line',
      x1: start[0],
      y1: start[1],
      x2: end[0],
      y2: end[1],
      strokeWidthPx: 12,
    },
    {
      kind: 'line',
      x1: start[0],
      y1: start[1],
      x2: at(runIn)[0],
      y2: at(runIn)[1],
      stroke,
      strokeWidth: 0.035,
      strokeLinecap: 'butt',
    },
    {
      kind: 'line',
      x1: at(1 - runIn)[0],
      y1: at(1 - runIn)[1],
      x2: end[0],
      y2: end[1],
      stroke,
      strokeWidth: 0.035,
      strokeLinecap: 'butt',
    },
  ]

  for (const [origin, sign] of [
    [start, 1],
    [end, -1],
  ] as const) {
    // Tail: perpendicular leg running from the cut line toward the view side.
    const tailEnd: FloorplanPoint = [
      origin[0] + look[0] * TAIL_LENGTH,
      origin[1] + look[1] * TAIL_LENGTH,
    ]
    children.push({
      kind: 'line',
      x1: origin[0],
      y1: origin[1],
      x2: tailEnd[0],
      y2: tailEnd[1],
      stroke,
      strokeWidth: 0.035,
      strokeLinecap: 'butt',
    })
    // Solid arrow head on the tail, pointing the way the section looks.
    const back: FloorplanPoint = [
      tailEnd[0] - look[0] * ARROW_LENGTH,
      tailEnd[1] - look[1] * ARROW_LENGTH,
    ]
    children.push({
      kind: 'polygon',
      points: [
        tailEnd,
        [back[0] + axis[0] * ARROW_HALF_WIDTH, back[1] + axis[1] * ARROW_HALF_WIDTH],
        [back[0] - axis[0] * ARROW_HALF_WIDTH, back[1] - axis[1] * ARROW_HALF_WIDTH],
      ],
      fill: stroke,
      stroke,
      strokeWidth: 0.006,
    })
    // Bubble, pushed outward past the end of the cut line.
    const centre: FloorplanPoint = [
      origin[0] - axis[0] * sign * BUBBLE_RADIUS * 1.15,
      origin[1] - axis[1] * sign * BUBBLE_RADIUS * 1.15,
    ]
    children.push(
      {
        kind: 'circle',
        cx: centre[0],
        cy: centre[1],
        r: BUBBLE_RADIUS,
        fill: '#ffffff',
        stroke,
        strokeWidth: 0.02,
      },
      {
        kind: 'line',
        x1: centre[0] - BUBBLE_RADIUS,
        y1: centre[1],
        x2: centre[0] + BUBBLE_RADIUS,
        y2: centre[1],
        stroke,
        strokeWidth: 0.014,
      },
      {
        kind: 'text',
        x: centre[0],
        y: centre[1] - 0.06,
        text: node.label || 'A',
        fontSize: 0.2,
        fill: stroke,
        fontWeight: 600,
        textAnchor: 'middle',
        dominantBaseline: 'alphabetic',
        upright: true,
      },
      {
        kind: 'text',
        x: centre[0],
        y: centre[1] + 0.22,
        text: node.sheetRef ?? '—',
        fontSize: 0.16,
        fill: stroke,
        textAnchor: 'middle',
        dominantBaseline: 'alphabetic',
        upright: true,
      },
    )
  }

  if (selected) {
    children.push(
      {
        kind: 'endpoint-handle',
        point: start,
        state: 'idle',
        affordance: 'move-section-marker-endpoint',
        payload: { endpoint: 'start' },
      },
      {
        kind: 'endpoint-handle',
        point: end,
        state: 'idle',
        affordance: 'move-section-marker-endpoint',
        payload: { endpoint: 'end' },
      },
    )
  }

  return { kind: 'group', children }
}
