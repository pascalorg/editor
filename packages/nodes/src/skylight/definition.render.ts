import {
  type AnyNode,
  type RoofSegmentNode,
  SkylightNode as SkylightNodeSchema,
  type SkylightNode as SkylightNodeType,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildSkylightFloorplan } from './floorplan'
import { buildSkylightRoofCut } from './roof-cut'
import { SkylightNode } from './schema'

export const skylightRenderDefinition: NodeRenderDefinition<typeof SkylightNode> & {
  kind: 'skylight'
} = {
  kind: 'skylight',
  schemaVersion: 1,
  schema: SkylightNode,
  category: 'structure',
  surfaceRole: 'glazing',
  defaults: () => {
    const stub = SkylightNodeSchema.parse({
      id: 'skylight_default' as never,
      type: 'skylight',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Dirty marks
    // cascade to the host segment's parent roof so its merged shell
    // re-CSGs with the new cut. `buildCut` returns the segment-local
    // box that's subtracted from shin / deck / wall.
    roofAccessory: {
      buildCut: (node: AnyNode, hostSegment: AnyNode) =>
        buildSkylightRoofCut(node as SkylightNodeType, hostSegment as RoofSegmentNode),
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
  floorplan: buildSkylightFloorplan,
  presentation: {
    label: 'Skylight',
    description: 'Framed glass opening on a roof segment.',
    icon: { kind: 'url', src: '/icons/skylight.webp' },
    paletteSection: 'structure',
    paletteOrder: 124,
  },
  mcp: {
    description:
      'A skylight on a roof segment. Five type variants (flat / walk-on / lantern / opening / sliding) — geometry beyond box stub coming later.',
  },
}
