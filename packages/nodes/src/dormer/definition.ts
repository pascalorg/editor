import { type NodeDefinition, DormerNode as DormerNodeSchema } from '@pascal-app/core'
import { dormerParametrics } from './parametrics'
import { DormerNode } from './schema'

/**
 * Dormer — a small house-shaped protrusion sitting on top of a roof
 * segment. The window opening is inlined into the dormer's schema
 * (window* fields drive parametric geometry on the front face), not
 * a hosted child node — so `relations.hosts` stays unset.
 *
 * **Scope of this port — stub.** Schema is complete (every field from
 * the archive, including the four per-surface material slots and the
 * full window-opening field set). Geometry renders a simple house
 * silhouette (box body + triangular gable roof) for all `roofType`
 * variants — the archive's variant-specific dormer roof shapes,
 * window opening + frame, sill, and the CSG trim where the dormer
 * meets the host roof are deferred. Per-surface paints (`topMaterial`,
 * `sideMaterial`, `wallMaterial`) resolve via the shared helper from
 * core but only roof / wall surfaces are emitted by the stub geometry.
 */
export const dormerDefinition: NodeDefinition<typeof DormerNode> = {
  kind: 'dormer',
  schemaVersion: 1,
  schema: DormerNode,
  category: 'structure',

  defaults: () => {
    // Zod fills in id/type via their .default() factories; we strip
    // both so the returned shape is a partial template a consumer can
    // spread into createNode() with a fresh id.
    const stub = DormerNodeSchema.parse({})
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
    // duplicate keeps the source's dimensions, materials, and window
    // options.
    move: () => import('./move-tool'),
  },

  parametrics: dormerParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place dormer on roof' },
    { key: 'R / Shift+R', label: 'Rotate ghost ±15°' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Dormer',
    description: 'House-shaped protrusion on a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 125,
  },

  mcp: {
    description:
      'A dormer on a roof segment. Box body + gable roof + inlined window opening. Geometry beyond the stub silhouette coming later.',
  },
}
