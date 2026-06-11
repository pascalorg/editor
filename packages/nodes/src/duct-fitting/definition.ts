import type { NodeDefinition } from '@pascal-app/core'
import { buildDuctFittingFloorplan } from './floorplan'
import { buildDuctFittingGeometry } from './geometry'
import { ductFittingParametrics } from './parametrics'
import { getDuctFittingPorts } from './ports'
import { rotateFittingNode } from './rotation'
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

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    fittingType: 'elbow',
    shape: 'round',
    width: 14,
    height: 8,
    angle: 90,
    diameter: 6,
    diameter2: 6,
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
  },

  parametrics: ductFittingParametrics,

  geometry: buildDuctFittingGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.fittingType,
      n.shape,
      n.width,
      n.height,
      n.angle,
      n.diameter,
      n.diameter2,
      n.ductMaterial,
      n.system,
    ]),

  ports: getDuctFittingPorts,

  floorplan: buildDuctFittingFloorplan,

  // R/T rotate a selected fitting ±45° around the shared active axis.
  // The default editor rotate only knows Y; fittings need X/Z for
  // risers, so this overrides it. Alt-cycling of the axis + the axis
  // badge live in `./system.tsx`.
  keyboardActions: {
    r: {
      appliesTo: (node) => node.type === 'duct-fitting',
      run: (node) => rotateFittingNode(node, 1),
    },
    t: {
      appliesTo: (node) => node.type === 'duct-fitting',
      run: (node) => rotateFittingNode(node, -1),
    },
  },

  system: { module: () => import('./system') },

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
    description: 'Elbow, tee, or reducer junction connecting round duct runs.',
    icon: { kind: 'iconify', name: 'lucide:git-branch' },
    paletteSection: 'structure',
    paletteOrder: 91,
  },

  mcp: {
    description:
      'A duct fitting (elbow, tee, or reducer) with typed connection ports. Position is level-local meters; rotation is an XYZ euler in radians.',
  },
}
