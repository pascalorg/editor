import { ChimneyNode as ChimneyNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { chimneyPaint } from './paint'
import { chimneyParametrics } from './parametrics'
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
      material: WHITE_MATERIAL,
      topMaterial: WHITE_MATERIAL,
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Dirty marks
    // cascade to the host segment's parent roof so its merged shell
    // re-renders. No `buildCut` — the chimney does its own self-trim
    // via `trimChimneyBodyAgainstRoof`; the host roof shell stays solid
    // underneath.
    roofAccessory: {},
    // Paint dispatch for the body / top surface split. The editor's
    // selection-manager routes paint hover / click / preview through
    // this entry rather than carrying a kind-name arm.
    paint: chimneyPaint,
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
