import {
  type ColumnNode,
  type DeclaredHostSurface,
  hitDerivedSurfaceProvider,
  type SurfaceProvider,
  type SurfaceRegion,
} from '@pascal-app/core'
import {
  columnCapitalBlocks,
  columnShaftLayout,
  getSegments,
  getShaftScaleAt,
  getShaftSegmentCount,
  getShaftTwistRadians,
} from './shape'

function roundRegion(radius: number, segments: number, yaw = 0): SurfaceRegion {
  return {
    kind: 'polygon',
    points: Array.from({ length: segments }, (_, i) => {
      const angle = (i * Math.PI * 2) / segments + yaw
      return [Math.sin(angle) * radius, Math.cos(angle) * radius]
    }),
  }
}

export function columnTopSurfaces(node: ColumnNode): DeclaredHostSurface[] {
  if (node.supportStyle !== 'vertical' || node.style === 'cluster') return []
  const layout = columnShaftLayout(node)
  const cap = columnCapitalBlocks(
    node,
    layout.shaftY + layout.shaftHeight,
    layout.capitalHeight,
  ).at(-1)
  let y: number
  let region: SurfaceRegion
  if (cap) {
    y = cap.y + cap.height
    if (cap.kind === 'round') region = roundRegion(cap.radius!, getSegments(node))
    else {
      const bevel = Math.min(
        Math.max(0, node.edgeSoftness ?? 0.025),
        Math.min(cap.width!, cap.depth!, cap.height) * 0.35,
      )
      region = { kind: 'rect', size: [cap.width! / 2 - bevel, cap.depth! / 2 - bevel] }
    }
  } else {
    const segments = getShaftSegmentCount(node)
    const scale = getShaftScaleAt(node, (segments - 0.5) / segments)
    const yaw = getShaftTwistRadians(node, segments - 1)
    y = layout.shaftY + layout.shaftHeight + (layout.shaftHeight / segments) * 0.015
    if (node.crossSection === 'square' || node.crossSection === 'rectangular') {
      const corner =
        Math.min(
          Math.max(0, node.shaftCornerRadius ?? 0.035),
          Math.min(node.width, node.depth) * 0.45,
        ) * scale
      const x = (node.width * scale) / 2 - corner
      const z = (node.depth * scale) / 2 - corner
      region = {
        kind: 'polygon',
        points: [
          [-x, -z],
          [x, -z],
          [x, z],
          [-x, z],
        ].map(([px, pz]) => [
          px! * Math.cos(yaw) + pz! * Math.sin(yaw),
          -px! * Math.sin(yaw) + pz! * Math.cos(yaw),
        ]),
      }
    } else region = roundRegion(node.radius * scale, getSegments(node), yaw)
  }
  return [{ id: 'top', position: [0, y, 0], normal: [0, 1, 0], region }]
}

export const columnSurfaceProvider: SurfaceProvider = {
  ...hitDerivedSurfaceProvider,
  surfaces: (host) => columnTopSurfaces(host as ColumnNode),
  resolveHit(host, hit, ctx) {
    const derived = hitDerivedSurfaceProvider.resolveHit(host, hit, ctx)
    if (!derived) return null
    const top = columnTopSurfaces(host as ColumnNode)[0]
    // Lower ornaments remain hit-derived; only the principal top has a durable resize identity.
    return top && Math.abs(hit.point[1] - top.position[1]) < 1e-4 ? top : derived
  },
}
