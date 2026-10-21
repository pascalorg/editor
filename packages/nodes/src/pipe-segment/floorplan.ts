import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import { runHangerFloorplan } from '../shared/run-hangers'
import { pipeContinuationHandlePlan, pipeEndpointPort } from './continuation'
import type { PipeSegmentNode } from './schema'
import { pipeGrade } from './slope'

const WASTE_COLOR = '#57534e'
const VENT_COLOR = '#78716c'

/**
 * Floor-plan representation of a DWV run, following drafting convention:
 * waste lines draw SOLID at the pipe's width, vent lines draw DASHED and
 * thin. Vertical stacks collapse to a circle.
 */
export function buildPipeSegmentFloorplan(
  node: PipeSegmentNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.path.length < 2) return null

  const points: FloorplanPoint[] = []
  // Plan point k ← original path index indexMap[k] (stacks collapse to one
  // plan point), so the path-point drag handle edits the right vertex.
  const indexMap: number[] = []
  for (let i = 0; i < node.path.length; i++) {
    const [x, , z] = node.path[i]!
    const prev = points[points.length - 1]
    if (prev && Math.abs(prev[0] - x) < 1e-6 && Math.abs(prev[1] - z) < 1e-6) continue
    points.push([x, z])
    indexMap.push(i)
  }

  const diameterM = node.diameter * INCHES_TO_METERS
  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const isVent = node.system === 'vent'
  const stroke =
    showSelectedChrome && palette ? palette.selectedStroke : isVent ? VENT_COLOR : WASTE_COLOR

  // Vertical stack — a single plan point: hub circle.
  if (points.length < 2) {
    const p = points[0] ?? [node.path[0]![0], node.path[0]![2]]
    return {
      kind: 'group',
      children: [
        ...runHangerFloorplan(node, ctx),
        {
          kind: 'circle',
          cx: p[0],
          cy: p[1],
          r: diameterM / 2 + 0.01,
          fill: 'none',
          stroke,
          strokeWidth: 2,
          vectorEffect: 'non-scaling-stroke',
          opacity: 0.95,
        },
      ],
    }
  }

  const children: FloorplanGeometry[] = [
    isVent
      ? {
          kind: 'polyline',
          points,
          stroke,
          strokeWidth: 1.5,
          vectorEffect: 'non-scaling-stroke',
          strokeDasharray: '6 4',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 0.9,
        }
      : {
          kind: 'polyline',
          points,
          stroke,
          strokeWidth: diameterM,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: showSelectedChrome ? 0.95 : 0.85,
        },
  ]

  // Selection chrome: one draggable handle per path vertex (2D twin of the
  // 3D selection handles). Routes to the shared `move-path-point` affordance.
  if (view?.selected) {
    for (let i = 1; i < node.path.length; i++) {
      const a = node.path[i - 1]!,
        b = node.path[i]!
      const grade = pipeGrade(a, b)
      if (grade === null || Math.abs(grade) < 1e-6) continue
      const length = Math.hypot(b[0] - a[0], b[2] - a[2])
      const sign = Math.sign(grade),
        dx = ((b[0] - a[0]) / length) * sign,
        dz = ((b[2] - a[2]) / length) * sign
      const x = (a[0] + b[0]) / 2,
        z = (a[2] + b[2]) / 2,
        size = Math.min(0.12, length / 5)
      children.push({
        kind: 'polyline',
        points: [
          [x - dx * size - (dz * size) / 2, z - dz * size + (dx * size) / 2],
          [x, z],
          [x - dx * size + (dz * size) / 2, z - dz * size - (dx * size) / 2],
        ],
        stroke,
        strokeWidth: 2,
        vectorEffect: 'non-scaling-stroke',
      })
      children.push({
        kind: 'text',
        x: x - dz * 0.18,
        y: z + dx * 0.18,
        text: `${(Math.abs(grade) * 100).toFixed(2)}%`,
        fontSize: 0.12,
        fill: stroke,
        textAnchor: 'middle',
        upright: true,
      })
    }

    for (let k = 0; k < points.length; k++) {
      children.push({
        kind: 'endpoint-handle',
        point: points[k]!,
        state: 'idle',
        affordance: 'move-path-point',
        payload: { pointIndex: indexMap[k]! },
      })
    }
    const continuationGap = Math.max(0.28, diameterM / 2 + 0.18)
    for (const endpoint of ['start', 'end'] as const) {
      const port = pipeEndpointPort(node, endpoint)
      const sceneNodes = ctx.sceneNodes ?? { [node.id]: node }
      const plan = pipeContinuationHandlePlan(node, endpoint, sceneNodes, continuationGap)
      if (!(port && plan)) continue
      if (
        Math.hypot(plan.position[0] - port.position[0], plan.position[2] - port.position[2]) < 1e-6
      )
        continue
      children.push({
        kind: 'midpoint-handle',
        point: [plan.position[0], plan.position[2]],
        activation: 'action',
        affordance: 'continue-run',
        payload: { action: 'continue-run', endpoint, fittingId: plan.fittingId },
      })
    }

    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k]!
      const b = points[k + 1]!
      const pathIndex = indexMap[k]!
      const nextPathIndex = indexMap[k + 1]!
      children.push({
        kind: 'midpoint-handle',
        point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        activation: 'action',
        affordance: 'branch-run',
        payload: {
          action: 'branch-run',
          segmentIndex: pathIndex,
          point: [
            (a[0] + b[0]) / 2,
            (node.path[pathIndex]![1] + node.path[nextPathIndex]![1]) / 2,
            (a[1] + b[1]) / 2,
          ],
        },
      })
    }
  }

  children.push(...runHangerFloorplan(node, ctx))
  return { kind: 'group', children }
}
