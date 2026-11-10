import type { DoorNode as DoorNodeType, RoofSegmentNode } from '@pascal-app/core'

import { doorSlots } from '@pascal-app/core'

import { NEW_DOOR_FRAME_THICKNESS } from '@pascal-app/core/building'
import type { NodeRenderDefinition } from '../definition-contributions'
import { doorBatchable } from '../shared/node-batch/batchable'
import { buildRoofWallOpeningCut } from '../shared/roof-wall-opening-cut'
import { openingSeenFromOutside } from '../wall/exterior'
import { doorMechanism } from './mechanism'
import { DoorNode } from './schema'

export const doorRenderDefinition: NodeRenderDefinition<typeof DoorNode> & { kind: 'door' } = {
  kind: 'door',
  schemaVersion: 2,
  schema: DoorNode,
  category: 'structure',
  surfaceRole: 'joinery',
  // Leverage the schema's zod `.default()` annotations to compute the
  // full default shape — door has 40+ fields, listing them inline would
  // duplicate the schema. Parse a minimal stub, drop id/type, return rest.
  defaults: () => {
    const stub = DoorNode.parse({
      id: 'door_default' as never,
      type: 'door',
      frameThickness: NEW_DOOR_FRAME_THICKNESS,
      casingFaceA: true,
      casingFaceB: true,
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    reveal: { phase: 'openings', style: 'cut' },
    exterior: openingSeenFromOutside,
    revealOnEdit: [
      'position',
      'width',
      'height',
      'sidelightLeft',
      'sidelightRight',
      'transomHeight',
      'openingShape',
      'openingKind',
      'doorType',
    ],
    batchable: doorBatchable,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    wallOpeningPlacement: true,
    // Doors also host on roof-segment wall faces (base walls under the
    // roof, gable ends). `buildCut` punches the opening into the
    // segment's wall brush; `dirtyHandledByOwnSystem` keeps the roof-merge
    // loop from consuming door dirty marks (DoorSystem owns them and
    // already cascades to the host via parentId).
    roofAccessory: {
      buildCut: (node, hostSegment) =>
        buildRoofWallOpeningCut(node as DoorNodeType, hostSegment as RoofSegmentNode),
      cutScope: 'wall',
      dirtyHandledByOwnSystem: true,
    },
    // `wallId` / `roofSegmentId` tie the door to its host and are
    // re-derived from the surface under the cursor when a preset is
    // placed. Host apps strip these at preset-save time via
    // `getHostRefFields(def)`.
    hostRefFields: ['wallId', 'roofSegmentId', 'roofFace'],
    // Panel / glass slots painted through the registry. The door system tags
    // each mesh with its `userData.slotId`; paint writes `node.slots`.
    slots: () => doorSlots(),
    mechanism: doorMechanism,
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Priority 3 mirrors the legacy DoorSystem (after animation at 2,
    // before wall mitering at 4).
    priority: 3,
  },
  presentation: {
    label: 'Door',
    description: 'A door cut into a wall. Animated open/close state.',
    icon: { kind: 'url', src: '/icons/door.webp' },
    paletteSection: 'structure',
    paletteOrder: 50,
  },
  mcp: {
    description: 'A door mounted on a wall, with type / dimensions / hardware options.',
  },
}
