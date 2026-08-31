import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import { getHvacEquipmentPorts } from './ports'
import type { HvacEquipmentNode } from './schema'

const BODY_FILL = '#c7cbd1'
const BODY_STROKE = '#6b7280'
const SUPPLY_COLOR = '#d4825a'
const RETURN_COLOR = '#5a8ad4'

/**
 * Floor-plan footprint for HVAC equipment: the cabinet rectangle
 * (rotated by yaw) with a diagonal so it reads as an equipment symbol,
 * plus a supply/return collar dot per duct port. Selected → themed
 * stroke + move handle.
 */
export function buildHvacEquipmentFloorplan(
  node: HvacEquipmentNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const [cx, , cz] = node.position
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  const hw = node.width / 2
  const hd = node.depth / 2
  // Local corner → plan, applying yaw. Plan x = world x, plan y = world z;
  // a +yaw about world Y maps local (x, z) to (x cos + z sin, -x sin + z cos).
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
      strokeWidth: showSelectedChrome ? 0.03 : 0.02,
      opacity: 0.92,
    },
    // Diagonal — the conventional "mechanical equipment" plan mark.
    {
      kind: 'line',
      x1: points[0]![0],
      y1: points[0]![1],
      x2: points[2]![0],
      y2: points[2]![1],
      stroke,
      strokeWidth: 1,
      vectorEffect: 'non-scaling-stroke',
      opacity: 0.7,
    },
  ]

  for (const port of getHvacEquipmentPorts(node)) {
    children.push({
      kind: 'circle',
      cx: port.position[0],
      cy: port.position[2],
      r: (port.diameter * INCHES_TO_METERS) / 2,
      fill: port.system === 'supply' ? SUPPLY_COLOR : RETURN_COLOR,
      opacity: 0.85,
    })
  }

  if (showSelectedChrome) {
    children.push({ kind: 'move-handle', point: [cx, cz] })
  }

  return { kind: 'group', children }
}
