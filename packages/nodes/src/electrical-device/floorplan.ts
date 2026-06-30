import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import type { ElectricalDeviceNode } from './schema'

const DEVICE_LABELS: Record<ElectricalDeviceNode['deviceType'], string> = {
  outlet: 'O',
  switch: 'S',
  light: 'L',
  'junction-box': 'JB',
  panel: 'P',
}

const DEVICE_COLORS: Record<ElectricalDeviceNode['deviceType'], string> = {
  outlet: '#f59e0b',
  switch: '#64748b',
  light: '#a78bfa',
  'junction-box': '#6b7280',
  panel: '#374151',
}

const DEVICE_RADIUS: Record<ElectricalDeviceNode['deviceType'], number> = {
  outlet: 0.08,
  switch: 0.07,
  light: 0.15,
  'junction-box': 0.09,
  panel: 0.18,
}

/**
 * Floor-plan symbol for an electrical device. Drawn as a labelled circle
 * at the device position, color-coded by device type. Rotates with the
 * device's yaw so wall-mounted devices face the correct direction.
 */
export function buildElectricalDeviceFloorplan(
  node: ElectricalDeviceNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const cx = node.position[0]
  const cy = node.position[2]
  const label = DEVICE_LABELS[node.deviceType]!
  const baseColor = DEVICE_COLORS[node.deviceType]!
  const r = DEVICE_RADIUS[node.deviceType]!

  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : baseColor

  const fontSize = r * 0.9

  const children: FloorplanGeometry[] = [
    {
      kind: 'circle',
      cx,
      cy,
      r,
      fill: 'none',
      stroke,
      strokeWidth: showSelectedChrome ? 2.5 : 1.5,
      vectorEffect: 'non-scaling-stroke',
      opacity: 0.9,
    },
    {
      kind: 'text',
      x: cx,
      y: cy,
      text: label,
      fontSize,
      fill: stroke,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      fontWeight: 600,
      opacity: 0.9,
    },
  ]

  if (showSelectedChrome) {
    children.push({ kind: 'move-handle', point: [cx, cy] })
  }

  return { kind: 'group', children }
}
