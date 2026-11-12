import { ChimneyNode as ChimneyNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildChimneyFloorplan } from './floorplan'
import { ChimneyNode } from './schema'

// Every fresh chimney starts as plain white (body + top). The paint
// flow / material picker writes preset refs or full `MaterialSchema`
// objects on top of this; until then both roles render `#ffffff`.
const WHITE_MATERIAL = {
  properties: {
    color: '#ffffff',
    roughness: 0.85,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front' as const,
  },
}

export const chimneyRenderDefinition: NodeRenderDefinition<typeof ChimneyNode> & {
  kind: 'chimney'
} = {
  kind: 'chimney',
  schemaVersion: 1,
  schema: ChimneyNode,
  category: 'structure',
  surfaceRole: 'wall',
  defaults: () => {
    const stub = ChimneyNodeSchema.parse({
      id: 'chimney_default' as never,
      type: 'chimney',
      material: WHITE_MATERIAL,
      topMaterial: WHITE_MATERIAL,
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
    // re-renders. No `buildCut` — the chimney does its own self-trim
    // via `trimChimneyBodyAgainstRoof`; the host roof shell stays solid
    // underneath.
    roofAccessory: {},
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildChimneyFloorplan,
  presentation: {
    label: 'Chimney',
    description: 'Vertical masonry stack on a roof segment.',
    icon: { kind: 'url', src: '/icons/chimney.webp' },
    paletteSection: 'structure',
    paletteOrder: 122,
  },
  mcp: {
    description:
      'A chimney on a roof segment. Square or round body; optional shoulder taper; sloped/flat/stepped cap; up to 4 protruding flues; optional cricket on the up-slope face.',
  },
}
