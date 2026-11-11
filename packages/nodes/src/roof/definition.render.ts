import {
  type AnyNodeId,
  RoofNode as RoofNodeSchema,
  type RoofNode as RoofNodeType,
  type RoofSegmentNode,
  roofFaceShapes,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { RoofNode } from './schema'

export const MIN_ROOF_FOOTPRINT = 1

export const roofRenderDefinition: NodeRenderDefinition<typeof RoofNode> & { kind: 'roof' } = {
  kind: 'roof',
  schemaVersion: 4,
  schema: RoofNode,
  category: 'structure',
  surfaceRole: 'roof',
  defaults: () => {
    const stub = RoofNodeSchema.parse({ id: 'roof_default' as never, type: 'roof' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    reveal: {
      phase: 'roof',
      style: 'assemble',
      height: 4,
      // The roof lifts out of the way while the furniture drops in, then seats again.
      clears: { for: 'furnishing', height: 2.4 },
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // F2 layers stack inward from the covering-top plane along the facet
    // normal; the body is their sum and the roof stores no thickness.
    assembly: { reference: 'covering', measure: 'normal', body: () => null },
    // Contribute a plan AABB to the alignment-guide candidate pool so a roof
    // (and any moving sibling) snaps against the roof's outer silhouette.
    // Roof has no centred-box footprint — it's the union of its
    // `roof-segment` children and its faces' outlines — so we hand the bridge
    // a resolved `aabb` directly. The roof moves by its origin via
    // `move-roof-tool`, so it only ever contributes static candidates; the
    // relocatable-box path never needs to apply to roofs.
    alignmentFootprint: (node, nodes) => {
      const roof = node as RoofNodeType
      if (!nodes) return null
      const cos = Math.cos(roof.rotation ?? 0)
      const sin = Math.sin(roof.rotation ?? 0)
      let minX = Number.POSITIVE_INFINITY
      let minZ = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxZ = Number.NEGATIVE_INFINITY
      let any = false
      for (const face of roofFaceShapes(roof, nodes)) {
        for (const [wx, wz] of face.outline) {
          minX = Math.min(minX, wx)
          maxX = Math.max(maxX, wx)
          minZ = Math.min(minZ, wz)
          maxZ = Math.max(maxZ, wz)
          any = true
        }
      }
      for (const childId of roof.children ?? []) {
        const segment = nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
        if (segment?.type !== 'roof-segment') continue
        const halfWidth = Math.max(segment.width, MIN_ROOF_FOOTPRINT) / 2
        const halfDepth = Math.max(segment.depth, MIN_ROOF_FOOTPRINT) / 2
        const sCos = Math.cos(segment.rotation ?? 0)
        const sSin = Math.sin(segment.rotation ?? 0)
        for (const [cx, cz] of [
          [-halfWidth, -halfDepth],
          [halfWidth, -halfDepth],
          [halfWidth, halfDepth],
          [-halfWidth, halfDepth],
        ] as const) {
          // Segment corner → roof-local.
          const rx = segment.position[0] + cx * sCos + cz * sSin
          const rz = segment.position[2] - cx * sSin + cz * sCos
          // Roof-local → world (apply roof rotation, then position).
          const wx = roof.position[0] + rx * cos + rz * sin
          const wz = roof.position[2] - rx * sin + rz * cos
          if (wx < minX) minX = wx
          if (wx > maxX) maxX = wx
          if (wz < minZ) minZ = wz
          if (wz > maxZ) maxZ = wz
          any = true
        }
      }
      return any ? { shape: 'aabb', minX, minZ, maxX, maxZ } : null
    },
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  presentation: {
    label: 'Roof',
    description: 'A pitched / hip / gable roof composed of one or more segments.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 100,
  },
  mcp: {
    description: 'A roof composed of segmented planes (gable / hip / shed).',
  },
}
