import {
  CUPOLA_LOUVERS_DEFAULT,
  CupolaNode as CupolaNodeSchema,
  cupolaSlots,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { CupolaNode } from './schema'

export const cupolaRenderDefinition: NodeRenderDefinition<typeof CupolaNode> & { kind: 'cupola' } =
  {
    kind: 'cupola',
    schemaVersion: 4,
    schema: CupolaNode,
    category: 'structure',
    surfaceRole: 'roof',
    defaults: () => {
      const stub = CupolaNodeSchema.parse({ id: 'cupola_default' as never, type: 'cupola' })
      const { id: _id, type: _type, ...rest } = stub
      return {
        ...rest,
        slots: { ...(rest.slots ?? {}), louvers: CUPOLA_LOUVERS_DEFAULT },
      }
    },
    capabilities: {
      exterior: true,
      slots: cupolaSlots,
      selectable: { hitVolume: 'bbox' },
      duplicable: true,
      deletable: true,
      // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
      // slope — no `buildCut`, just the dirty cascade so the parent roof's
      // merged shell rebuilds when the cupola moves / resizes.
      roofAccessory: {},
    },
    rendersChildren: false,
    renderer: {
      kind: 'parametric',
      module: () => import('./renderer'),
    },
    presentation: {
      label: 'Cupola',
      description: 'Louvered roof lantern with a dome or pyramid cap and optional finial.',
      icon: { kind: 'url', src: '/icons/cupola.webp' },
      paletteSection: 'structure',
      paletteOrder: 122,
    },
    mcp: {
      description:
        'A louvered cupola (roof lantern) on a roof segment. Roof style: dome / pyramid, optional finial. Parametric width/depth/height.',
    },
  }
