import {
  type AnyNode,
  type AnyNodeId,
  type NodeDefinition,
  SectionPlaneNode as SectionPlaneNodeSchema,
  useScene,
} from '@pascal-app/core'
import { buildSectionPlaneGeometry } from './geometry'
import { sectionPlaneParametrics } from './parametrics'
import { SectionPlaneNode } from './schema'

/**
 * Every other section plane that is currently active. Activating one has to
 * stand the others down — the renderer cuts with a single plane, so two
 * "active" planes would silently make one of them a lie.
 */
function otherActiveSectionPlaneIds(exceptId: AnyNodeId): AnyNodeId[] {
  const nodes = useScene.getState().nodes
  const ids: AnyNodeId[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'section-plane') continue
    if (node.id === exceptId) continue
    if (node.active) ids.push(node.id)
  }
  return ids
}

export const sectionPlaneDefinition: NodeDefinition<typeof SectionPlaneNode> = {
  kind: 'section-plane',
  schemaVersion: 1,
  schema: SectionPlaneNode,
  category: 'analysis',
  // A view aid, not model content — it must not end up in exported geometry.
  bake: 'strip',

  defaults: () => {
    const stub = SectionPlaneNodeSchema.parse({
      id: 'section-plane_default' as never,
      type: 'section-plane',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    // Sliding the plane through the model is the whole interaction, so all
    // three axes stay free and the grid must not quantise the cut height.
    movable: { axes: ['x', 'y', 'z'], gridSnap: false },
    rotatable: { axes: ['x', 'y', 'z'], snapAngles: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] },
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
    // A cut belongs to the view it was set up for; there is nothing reusable
    // to save into the catalog.
    presettable: false,
  },

  parametrics: {
    ...sectionPlaneParametrics,
    reconcile: (prev, next) => {
      if (!next.active || prev.active) return []
      return otherActiveSectionPlaneIds(next.id).map((id) => ({
        id,
        data: { active: false } as Partial<AnyNode>,
      }))
    },
  },

  geometry: buildSectionPlaneGeometry,
  system: {
    module: () => import('./system'),
    priority: 5,
  },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place section plane' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Section Plane',
    description: 'Cuts the model on an arbitrary plane so you can see inside it.',
    icon: { kind: 'iconify', name: 'lucide:scissors' },
    paletteSection: 'site',
    paletteOrder: 40,
  },

  mcp: {
    description:
      'An arbitrary cutting plane used to look inside the model. Only the active plane cuts.',
  },
}
