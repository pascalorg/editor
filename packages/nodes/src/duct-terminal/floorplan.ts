import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { terminalSystem } from './ports'
import type { DuctTerminalNode } from './schema'

const SUPPLY_COLOR = '#d4825a'
const RETURN_COLOR = '#5a8ad4'
const FRAME_STROKE = '#6b7280'
const FACE_FILL = '#e5e7eb'

/**
 * Floor-plan symbol for a duct terminal: the face rectangle (rotated by
 * yaw) with the conventional register cross-slats hinted as a single
 * mid-line, tinted by system. Wall mounts render the same footprint —
 * the face projects to a thin strip, which is close enough for plan
 * reading at this stage.
 */
export function buildDuctTerminalFloorplan(
  node: DuctTerminalNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const [cx, , cz] = node.position
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  const hw = node.width / 2
  const hd = (node.mount === 'wall' ? 0.06 : node.depth) / 2
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
  const accent = terminalSystem(node) === 'supply' ? SUPPLY_COLOR : RETURN_COLOR
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : FRAME_STROKE

  const mid1 = corner(-hw * 0.8, 0)
  const mid2 = corner(hw * 0.8, 0)

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill: FACE_FILL,
      stroke,
      strokeWidth: showSelectedChrome ? 0.025 : 0.015,
      opacity: 0.92,
    },
    {
      kind: 'line',
      x1: mid1[0],
      y1: mid1[1],
      x2: mid2[0],
      y2: mid2[1],
      stroke: accent,
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
      opacity: 0.9,
    },
  ]

  if (showSelectedChrome) {
    children.push({ kind: 'move-handle', point: [cx, cz] })
  }

  return { kind: 'group', children }
}
