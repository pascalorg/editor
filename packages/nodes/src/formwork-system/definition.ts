import type { NodeDefinition } from '@pascal-app/core/registry'
import { buildFormworkGeometry } from './geometry'
import { FormworkSystemNode } from './schema'

/**
 * Formwork dressing for a wall. Three-checkbox model: `geometry` only,
 * no renderer/tool/floorplan — same shape as fence/shelf. Never placed
 * by hand (`presentation.hidden: true`); created by
 * `buildFormworkNode()` (see attach.ts) from the wall panel's
 * "Add formwork geometry" button or the AI chat tool. See
 * `wiki/formwork-system-plan.md`.
 */
export const formworkSystemDefinition: NodeDefinition<typeof FormworkSystemNode> = {
  kind: 'formwork-system',
  schemaVersion: 1,
  category: 'structure',
  schema: FormworkSystemNode,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
  },

  geometry: buildFormworkGeometry,
  geometryKey: (n) => {
    const node = n as FormworkSystemNode
    return JSON.stringify([node.parentId, node.panelWidth])
  },

  presentation: {
    label: 'Formwork',
    icon: { kind: 'iconify', name: 'lucide:grid-3x3' },
    hidden: true,
  },

  mcp: {
    description:
      'Procedural formwork (shutter panels, ties, walers) dressing a wall, generated from the wall\'s formworkType/tieSpacing/walerSpacing fields. Created via attachFormworkToWall, not placed by hand.',
  },
}
