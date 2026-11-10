import {
  getStairFloorPlacedFootprints,
  StairNode as StairNodeSchema,
  type StairNode as StairNodeType,
  stairFootprintAABB,
  stairSlots,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { StairNode } from './schema'

export const stairRenderDefinition: NodeRenderDefinition<typeof StairNode> & { kind: 'stair' } = {
  kind: 'stair',
  schemaVersion: 2,
  schema: StairNode,
  category: 'structure',
  surfaceRole: 'joinery',
  defaults: () => {
    const stub = StairNodeSchema.parse({ id: 'stair_default' as never, type: 'stair' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    reveal: { phase: 'circulation', style: 'drop', height: 2.5 },
    revealOnEdit: [
      'stairType',
      'width',
      'totalRise',
      'stepCount',
      'thickness',
      'innerRadius',
      'sweepAngle',
      'railingMode',
      'topLandingDepth',
    ],
    hostRefFields: ['destinationSurfaceId'],
    surfacePlacement: 'floor-only',
    selectable: { hitVolume: 'bbox' },
    // A stair has no centred box footprint: straight = a cumulative
    // `stair-segment` chain, curved / spiral = an annular sector. Hand the
    // alignment bridge the resolved plan `aabb` directly (not a `box`) — the
    // moving-anchor helper can relocate the same shape when a stair is being
    // placed or dragged.
    alignmentFootprint: (node, nodes) => {
      const aabb = stairFootprintAABB(node as StairNodeType, nodes)
      return aabb ? { shape: 'aabb', ...aabb } : null
    },
    duplicable: { subtree: true },
    deletable: true,
    floorPlaced: {
      footprints: (node, ctx) =>
        ctx ? getStairFloorPlacedFootprints(node as StairNodeType, ctx.nodes) : [],
    },
    slots: (node) => stairSlots(node as StairNodeType),
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
    label: 'Stair',
    description:
      'A stair composed of one or more flights with configurable treads, risers, railings.',
    icon: { kind: 'url', src: '/icons/stairs.webp' },
    paletteSection: 'structure',
    paletteOrder: 110,
  },
  mcp: {
    description: 'A multi-flight stair with segmented geometry.',
  },
}
