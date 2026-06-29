import type { NodeDefinition } from '@pascal-app/core'
import { ductBodyPaint, ductBodySlots } from '../shared/duct-body-paint'
import { rotateFittingNode } from '../shared/fitting-rotation'
import { buildDuctFittingFloorplan } from './floorplan'
import { buildDuctFittingGeometry } from './geometry'
import { ductFittingParametrics } from './parametrics'
import { getDuctFittingPorts } from './ports'
import { DuctFittingNode } from './schema'

/**
 * Phase 2 of the HVAC node system — duct fittings (elbow / tee / reducer)
 * and the first kind to expose typed ports (`def.ports`).
 *
 * Composition: `def.geometry` only, same as duct-segment. Ports are the
 * architectural payload: placement tools snap onto them, and a later
 * slice walks them to build the supply/return system graph.
 */
export const ductFittingDefinition: NodeDefinition<typeof DuctFittingNode> = {
  kind: 'duct-fitting',
  schemaVersion: 1,
  schema: DuctFittingNode,
  category: 'utility',
  distributionRole: 'fitting',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    fittingType: 'elbow',
    shape: 'rect',
    width: 14,
    height: 8,
    shape2: 'rect',
    width2: 14,
    height2: 8,
    angle: 90,
    branchAngle: 90,
    diameter: 12,
    diameter2: 12,
    ductMaterial: 'sheet-metal',
    system: 'supply',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    // `cursorAttached`: a fitting is a small connector — an offset-
    // preserving drag reads as the mesh trailing the mouse, so pin its
    // origin to the cursor instead.
    movable: { axes: ['x', 'y', 'z'], gridSnap: true, cursorAttached: true },
    duplicable: true,
    deletable: true,
    slots: () => ductBodySlots(),
    paint: ductBodyPaint,
  },

  parametrics: ductFittingParametrics,

  geometry: buildDuctFittingGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.fittingType,
      // The mitered elbow + flange profiles swap width/height roles based
      // on where world-up sits in the local frame, so orientation is a
      // geometry input.
      n.rotation,
      n.shape,
      n.width,
      n.height,
      n.shape2,
      n.width2,
      n.height2,
      n.angle,
      n.branchAngle,
      n.diameter,
      n.diameter2,
      n.ductMaterial,
      n.system,
      n.slots,
    ]),

  ports: getDuctFittingPorts,

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

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place fitting' },
    { key: 'Hover a duct end', label: 'Snap onto the run' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Alt', label: 'Switch rotation axis (Y → X → Z)' },
    { key: 'Esc', label: 'Exit' },
  ],

  presentation: {
    label: 'Duct Fitting',
    description: 'Elbow, tee, reducer, or square-to-round transition connecting duct runs.',
    icon: { kind: 'url', src: '/icons/duct-fitting.webp' },
    paletteSection: 'structure',
    paletteOrder: 91,
  },

  mcp: {
    description:
      'A duct fitting (elbow, tee, reducer, or square-to-round transition) with typed connection ports. Position is level-local meters; rotation is an XYZ euler in radians.',
  },
}
