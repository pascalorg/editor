import { CadUnderlayNode as CadUnderlayNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { buildCadUnderlayFloorplan } from './floorplan'
import { CadUnderlayNode } from './schema'

/**
 * CAD underlay — a locked reference drawing imported from DXF/DWG, laid flat
 * on the level plane so the user can trace a 3D model over it.
 *
 * It is deliberately inert: not selectable, not movable, never a pointer
 * target. Its whole job is to be visible and to be snapped to. The geometry
 * lives in an asset rather than the node (`schema.ts` explains why), so both
 * views read it through the editor's underlay cache.
 */
export const cadUnderlayDefinition: NodeDefinition<typeof CadUnderlayNode> = {
  kind: 'cad-underlay',
  // Reference material, not part of the building — the baked viewer should
  // never ship someone's source drawing. Same treatment as `guide`.
  bake: 'strip',
  schemaVersion: 1,
  schema: CadUnderlayNode,
  category: 'site',

  defaults: () => {
    const stub = CadUnderlayNodeSchema.parse({
      id: 'cad-underlay_default' as never,
      type: 'cad-underlay',
      url: 'asset://placeholder',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    // No `selectable`: a locked underlay cannot be picked in either view. The
    // node is managed from the reference panel instead, which is also where
    // unlocking for calibration lives.
    duplicable: false,
    deletable: true,
    // A scene-specific reference drawing has no meaning as a catalog preset.
    presettable: false,
  },

  // Nothing rebuilds this kind from the dirty queue — the renderer owns its
  // geometry and reacts to the asset load itself.
  dirtyTracking: false,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildCadUnderlayFloorplan,

  presentation: {
    label: 'CAD Underlay',
    description: 'A locked DXF/DWG reference drawing to trace over.',
    icon: { kind: 'url', src: '/icons/blueprint.webp' },
    paletteSection: 'site',
    paletteOrder: 31,
  },

  mcp: {
    description: 'A locked CAD reference drawing placed on a level to model over.',
  },
}
