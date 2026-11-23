import { useScene } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { getRotationAxis, rotateEulerWorld } from '../shared/fitting-rotation'
import { pipeFittingToolOptions } from '../shared/fitting-tool-options'
import { pipeFittingQuickActions } from '../shared/mep-fitting-actions'
import { pipeFittingParametrics } from './parametrics'
import type { PipeFittingNode } from './schema'

export const pipeFittingEditContribution: NodeEditContribution<typeof PipeFittingNode> = {
  snapProfile: 'item',
  parametrics: pipeFittingParametrics,
  quickActions: pipeFittingQuickActions,
  quickActionNodeScope: 'level',
  // R/T rotate a selected fitting ±45° around the shared active axis —
  // same scheme as duct fittings (the default editor rotate only knows
  // Y; DWV stacks need X/Z). Alt-cycling lives in `./selection.tsx`.
  keyboardActions: {
    r: {
      appliesTo: (node) => node.type === 'pipe-fitting',
      run: (node) =>
        useScene.getState().updateNode(node.id, {
          rotation: rotateEulerWorld((node as PipeFittingNode).rotation, getRotationAxis(), 1),
        }),
    },
    t: {
      appliesTo: (node) => node.type === 'pipe-fitting',
      run: (node) =>
        useScene.getState().updateNode(node.id, {
          rotation: rotateEulerWorld((node as PipeFittingNode).rotation, getRotationAxis(), -1),
        }),
    },
    axisCycling: true,
  },
  // Alt-cycles the active rotation axis while a fitting is selected.
  // Editor-only (drives `useEditor.rotationAxis`), so it mounts via the
  // editor's SelectionAffordanceManager rather than `def.system`.
  affordanceTools: {
    selection: () => import('./selection'),
    move: () => import('./move-tool'),
  },
  toolOptions: pipeFittingToolOptions,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place fitting' },
    { key: 'Hover a pipe end', label: 'Snap onto the run' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Alt', label: 'Switch rotation axis (Y → X → Z)' },
    { key: 'Esc', label: 'Exit' },
  ],
}
