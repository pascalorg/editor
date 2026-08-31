import type { NodeDefinition } from '@pascal-app/core'
import { buildDuctTerminalFloorplan } from './floorplan'
import { buildDuctTerminalGeometry } from './geometry'
import { ductTerminalParametrics } from './parametrics'
import { getDuctTerminalPorts } from './ports'
import { DuctTerminalNode } from './schema'

/**
 * Phase 3 of the HVAC node system — duct terminals: supply registers,
 * ceiling diffusers, return grilles. The end of the air loop. One typed
 * port at the collar (mount-aware direction) so duct runs end onto a
 * terminal like any other port.
 *
 * Composition: `def.geometry` only. Yaw-only rotation — the editor's
 * default R-rotate works on a selected terminal.
 */
export const ductTerminalDefinition: NodeDefinition<typeof DuctTerminalNode> = {
  kind: 'duct-terminal',
  schemaVersion: 1,
  schema: DuctTerminalNode,
  category: 'utility',
  distributionRole: 'terminal',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    terminalType: 'supply-register',
    mount: 'floor',
    width: 0.3,
    depth: 0.15,
    collarShape: 'round',
    collarDiameter: 6,
    collarWidth: 10,
    collarHeight: 6,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true, portSnap: { systems: ['supply', 'return'] } },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
    // A floor register rests on top of whatever slab is under it — the
    // generic FloorElevationSystem lifts its mesh Y by the slab's elevation
    // so the face sits on the slab surface instead of sinking into it.
    // Ceiling / wall mounts derive their Y elsewhere, so `applies` skips them.
    floorPlaced: {
      footprint: (node) => {
        const t = node as DuctTerminalNode
        return { dimensions: [t.width, 0, t.depth], rotation: [0, t.rotation, 0] }
      },
      applies: (node) => (node as DuctTerminalNode).mount === 'floor',
    },
  },

  parametrics: ductTerminalParametrics,

  geometry: buildDuctTerminalGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.terminalType,
      n.mount,
      n.width,
      n.depth,
      n.collarShape,
      n.collarDiameter,
      n.collarWidth,
      n.collarHeight,
    ]),

  ports: getDuctTerminalPorts,

  floorplan: buildDuctTerminalFloorplan,

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place register' },
    { key: 'M', label: 'Mount: floor / ceiling / wall' },
    { key: 'R / T', label: 'Rotate ±45° (floor / ceiling)' },
    { key: 'Esc', label: 'Exit' },
  ],

  presentation: {
    label: 'Register',
    description:
      'Duct terminal — supply register, ceiling diffuser, or return grille. Duct runs end at its collar.',
    icon: { kind: 'url', src: '/icons/registers.webp' },
    paletteSection: 'structure',
    paletteOrder: 93,
  },

  mcp: {
    description:
      'A duct terminal (supply register, ceiling diffuser, or return grille) with a single collar port. Mount (floor/ceiling/wall) drives the face orientation and collar direction.',
  },
}
