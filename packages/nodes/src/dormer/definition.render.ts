import {
  type AnyNode,
  DormerNode as DormerNodeSchema,
  type DormerNode as DormerNodeType,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildDormerRoofCut } from './csg-geometry'
import { DormerNode } from './schema'

export const dormerRenderDefinition: NodeRenderDefinition<typeof DormerNode> & { kind: 'dormer' } =
  {
    kind: 'dormer',
    schemaVersion: 4,
    schema: DormerNode,
    category: 'structure',
    surfaceRole: 'roof',
    defaults: () => {
      // Zod fills in id/type via their .default() factories; we strip
      // both so the returned shape is a partial template a consumer can
      // spread into createNode() with a fresh id.
      const stub = DormerNodeSchema.parse({})
      const { id: _id, type: _type, ...rest } = stub
      return rest
    },
    capabilities: {
      exterior: true,
      selectable: { hitVolume: 'bbox' },
      // Dormers own their WindowNode children. Duplicate the complete subtree
      // so the copied dormer never aliases windows from the source dormer.
      duplicable: { subtree: true },
      deletable: true,
      // Mounts on a roof segment via `roofSegmentId`. Dirty marks
      // cascade to the host segment's parent roof so its merged shell
      // re-CSGs with the new cut. `buildCut` returns the segment-local
      // geometry the merge loop subtracts from shin / deck / wall.
      roofAccessory: {
        buildCut: (node: AnyNode, _hostSegment: AnyNode) =>
          buildDormerRoofCut(node as DormerNodeType),
      },
    },
    relations: {
      hosts: ['window'],
      cascadeDelete: 'descendants',
    },
    rendersChildren: false,
    renderer: {
      kind: 'parametric',
      module: () => import('./renderer'),
    },
    presentation: {
      label: 'Dormer',
      description: 'House-shaped protrusion on a roof segment.',
      icon: { kind: 'url', src: '/icons/dormer.webp' },
      paletteSection: 'structure',
      paletteOrder: 125,
    },
    mcp: {
      description: 'A dormer on a roof segment. Its windows are hosted WindowNode children.',
    },
  }
