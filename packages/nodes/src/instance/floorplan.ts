import type { FloorplanGeometry, GeometryContext, InstanceNode } from '@pascal-app/core'

const MIN_FOOTPRINT_SIZE = 0.25

export function buildInstanceFloorplan(
  node: InstanceNode,
  ctx?: GeometryContext,
): FloorplanGeometry {
  const [x, , z] = node.position
  const width = Math.max(MIN_FOOTPRINT_SIZE, Math.abs(node.scale[0]))
  const depth = Math.max(MIN_FOOTPRINT_SIZE, Math.abs(node.scale[2]))
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const selected = ctx?.viewState?.selected ?? false

  const children: FloorplanGeometry[] = [
    {
      kind: 'group',
      transform: { translate: [x, z], rotate: -node.rotation[1] },
      children: [
        {
          kind: 'rect',
          x: -halfWidth,
          y: -halfDepth,
          width,
          height: depth,
          rx: Math.min(0.08, width / 6),
          fill: selected ? '#c4b5fd' : '#ddd6fe',
          stroke: selected ? '#6d28d9' : '#7c3aed',
          strokeWidth: 0.025,
          opacity: 0.9,
        },
        {
          kind: 'line',
          x1: -halfWidth,
          y1: -halfDepth,
          x2: halfWidth,
          y2: halfDepth,
          stroke: '#7c3aed',
          strokeWidth: 0.018,
          opacity: 0.65,
        },
        {
          kind: 'line',
          x1: halfWidth,
          y1: -halfDepth,
          x2: -halfWidth,
          y2: halfDepth,
          stroke: '#7c3aed',
          strokeWidth: 0.018,
          opacity: 0.65,
        },
      ],
    },
  ]

  if (selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}
