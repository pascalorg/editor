import type { NodeDefinition } from '@pascal-app/core/registry'
import { FormworkBoxOutNode } from './schema'

/**
 * An opening former — the void a wall or slab must not be solid through, where
 * the void is neither a door nor a window (a pipe sleeve, a cable penetration,
 * a light shaft). The box-out that forms it is built by the host's shutter:
 * the opening subtracts from the panels and the reveal faces are returned
 * inside it, so giving the box-out its own mesh would draw the same boards
 * twice. Registered without geometry for that reason, exactly like
 * `construction-joint`.
 *
 * Placed as a child of the element it voids. Hidden from the palette because a
 * box-out without a host is meaningless — it is created by the host's tools.
 */
export const formworkBoxOutDefinition: NodeDefinition<typeof FormworkBoxOutNode> = {
  kind: 'formwork-box-out',
  schemaVersion: 1,
  category: 'structure',
  schema: FormworkBoxOutNode,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    width: 0.3,
    height: 0.3,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  // No geometry and no system rebuild this kind — the host's shutter does, and
  // the formwork dirty-scope names the host when a box-out moves or resizes.
  dirtyTracking: false,

  presentation: {
    label: 'Box-out',
    icon: { kind: 'iconify', name: 'lucide:box' },
    hidden: true,
  },

  mcp: {
    description:
      'An opening former — a void in a wall or slab that is neither a door nor a window: a pipe sleeve, a cable penetration, a light shaft. Hosted by the element it voids (parentId is the host, position is the wall-child frame [along, centreY, z]). The box-out that forms it — the reveal faces inside the void, cut to the draft and struck in pieces — is built by the host shutter, so creating or resizing one re-cuts the host panels.',
  },
}
