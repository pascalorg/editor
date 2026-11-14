import { TurbineVentNode as TurbineVentNodeSchema, turbineVentSlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildTurbineVentFloorplan } from './floorplan'
import { TurbineVentNode } from './schema'

export const turbineVentRenderDefinition: NodeRenderDefinition<typeof TurbineVentNode> & {
  kind: 'turbine-vent'
} = {
  kind: 'turbine-vent',
  schemaVersion: 3,
  schema: TurbineVentNode,
  category: 'structure',
  surfaceRole: 'roof',
  defaults: () => {
    const stub = TurbineVentNodeSchema.parse({ id: 'tvent_default' as never, type: 'turbine-vent' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    slots: turbineVentSlots,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // slope — no `buildCut`, just the dirty cascade so the parent roof's
    // merged shell rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildTurbineVentFloorplan,
  presentation: {
    label: 'Turbine Vent',
    description: 'Wind-driven spinning whirlybird exhaust vent for a roof slope.',
    icon: { kind: 'url', src: '/icons/turbine-vent.webp' },
    paletteSection: 'structure',
    paletteOrder: 121,
  },
  mcp: {
    description:
      'A spinning turbine (whirlybird) vent on a roof segment. Style: globe / cylinder. Parametric diameter/height/neckHeight/vaneCount and idle spinSpeed.',
  },
}
