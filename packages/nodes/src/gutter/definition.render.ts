import { GutterNode as GutterNodeSchema, gutterSlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildGutterFloorplan } from './floorplan'
import { GutterNode } from './schema'

export const gutterRenderDefinition: NodeRenderDefinition<typeof GutterNode> & { kind: 'gutter' } =
  {
    kind: 'gutter',
    schemaVersion: 4,
    schema: GutterNode,
    category: 'structure',
    surfaceRole: 'roof',
    defaults: () => {
      const stub = GutterNodeSchema.parse({
        id: 'gutter_default' as never,
        type: 'gutter',
      })
      const { id: _id, type: _type, ...rest } = stub
      return rest
    },
    capabilities: {
      exterior: true,
      slots: gutterSlots,
      selectable: { hitVolume: 'bbox' },
      duplicable: true,
      deletable: true,
      // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
      // eave fascia — no `buildCut`, just the dirty cascade so the
      // parent roof's merged shell rebuilds when the gutter moves /
      // resizes.
      roofAccessory: {},
    },
    rendersChildren: false,
    renderer: {
      kind: 'parametric',
      module: () => import('./renderer'),
    },
    floorplan: buildGutterFloorplan,
    presentation: {
      label: 'Gutter',
      description: 'Rain-water channel running along the eave of a roof segment.',
      icon: { kind: 'url', src: '/icons/gutter.webp' },
      paletteSection: 'structure',
      paletteOrder: 122,
    },
    mcp: {
      description:
        'A gutter strip running along the eave of a roof segment. Three profiles (k-style ogee fascia, half-round, square box), length / size / thickness parametric.',
    },
  }
