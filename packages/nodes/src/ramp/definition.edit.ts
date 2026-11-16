import type { RampNode } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import {
  createSlotPaintCapability,
  previewGeometrySlot,
  resolveSlotByReRaycast,
} from '../shared/slot-paint'

export const rampEditContribution: NodeEditContribution<typeof RampNode> = {
  snapProfile: 'structural',
  capabilities: {
    paint: createSlotPaintCapability({
      resolveRole: resolveSlotByReRaycast,
      applyPreview: previewGeometrySlot,
    }),
  },
  tool: () => import('./tool'),
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<RampNode>,
  },
  parametrics: { groups: [], customPanel: () => import('./panel') },
  toolHints: [
    { key: 'Left click', label: 'Add centreline point' },
    { key: 'Enter', label: 'Create ramp' },
    { key: 'Backspace', label: 'Remove last segment' },
    { key: 'Alt', label: 'Free placement' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
