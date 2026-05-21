import {
  type NodeDefinition,
  ChimneyNode as ChimneyNodeSchema,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { chimneyParametrics } from './parametrics'
import { ChimneyNode } from './schema'

// Default material refs — body picks up a brick wall texture and the
// top a stone-wall texture so a fresh chimney reads as masonry instead
// of the flat fallback color (which can look washed-out / "white"
// under bright scene lighting).
const DEFAULT_BODY_MATERIAL_PRESET = toLibraryMaterialRef('flooring-rusticbrick')
const DEFAULT_TOP_MATERIAL_PRESET = toLibraryMaterialRef('flooring-wallstone1')

/**
 * Chimney — a vertical masonry stack hosted on a roof segment.
 *
 * Three-checkbox model: `def.renderer` (custom — segment-aware
 * geometry from `useScene`, body height derived from
 * `segment.wallHeight + roofHeight + heightAboveRidge`), no `geometry`,
 * no `system`.
 *
 * **Option C scope**: chimney ships in the registry shape with solid
 * geometry. CSG-driven decoration (cap flue holes, body cavity,
 * panels, bands) is preserved in the schema but not rendered yet —
 * those re-light when roof-segment migrates to Stage B and introduces
 * a `roofCutout` capability the parent segment can read.
 */
export const chimneyDefinition: NodeDefinition<typeof ChimneyNode> = {
  kind: 'chimney',
  schemaVersion: 1,
  schema: ChimneyNode,
  category: 'structure',

  defaults: () => {
    const stub = ChimneyNodeSchema.parse({
      id: 'chimney_default' as never,
      type: 'chimney',
      materialPreset: DEFAULT_BODY_MATERIAL_PRESET,
      topMaterialPreset: DEFAULT_TOP_MATERIAL_PRESET,
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  affordanceTools: {
    // Drag-to-place tool for duplicate + move. Reuses the placement
    // ghost preview but seeds it from the moving (cloned) node so the
    // duplicate keeps the source's body shape, materials, panels, etc.
    move: () => import('./move-tool'),
  },

  parametrics: chimneyParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place chimney on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Chimney',
    description: 'Vertical masonry stack on a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 122,
  },

  mcp: {
    description:
      'A chimney on a roof segment. Square or round body; optional shoulder taper; sloped/flat/stepped cap; up to 4 protruding flues; optional cricket on the up-slope face.',
  },
}
