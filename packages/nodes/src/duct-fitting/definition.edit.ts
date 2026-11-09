import type { NodeEditContribution } from '../definition-contributions'
import { ductBodyPaint } from '../shared/duct-body-paint'
import { rotateFittingNode } from '../shared/fitting-rotation'
import { ductFittingToolOptions } from '../shared/fitting-tool-options'
import { buildDuctFittingFloorplan } from './floorplan'
import { ductFittingParametrics } from './parametrics'
import type { DuctFittingNode } from './schema'

export const ductFittingEditContribution: NodeEditContribution<typeof DuctFittingNode> = {
  snapProfile: 'item',
  capabilities: {
    paint: ductBodyPaint,
  },
  parametrics: ductFittingParametrics,
  floorplan: buildDuctFittingFloorplan,
  // R/T rotate a selected fitting ±45° around the shared active axis.
  // The default editor rotate only knows Y; fittings need X/Z for
  // risers, so this overrides it. Alt-cycling of the axis + the axis
  // badge live in `./selection.tsx`.
  keyboardActions: {
    r: {
      appliesTo: (node) => node.type === 'duct-fitting',
      run: (node) => rotateFittingNode(node, 1),
    },
    t: {
      appliesTo: (node) => node.type === 'duct-fitting',
      run: (node) => rotateFittingNode(node, -1),
    },
    axisCycling: true,
  },
  // Alt-cycles the active rotation axis while a fitting is selected.
  // Editor-only (drives `useEditor.rotationAxis`), so it mounts via the
  // editor's SelectionAffordanceManager rather than `def.system`.
  affordanceTools: {
    selection: () => import('./selection'),
    // Ghost-preview duplicate / move. Duplicate is pure drag-to-place: a
    // translucent copy of the fitting (built from its real geometry, at its
    // own rotation, so an elbow / riser stays properly aligned) follows the
    // cursor and only lands on the commit click. Takes priority over
    // `capabilities.movable` in the MoveTool dispatcher.
    move: () => import('./move-tool'),
  },
  toolOptions: ductFittingToolOptions,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place fitting' },
    { key: 'Hover a duct end', label: 'Snap onto the run' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Alt', label: 'Switch rotation axis (Y → X → Z)' },
    { key: 'Esc', label: 'Exit' },
  ],
}
