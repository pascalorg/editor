import type { NodeDefinition } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { getRotationAxis, rotateEulerWorld } from '../duct-fitting/rotation'
import { buildPipeFittingFloorplan } from './floorplan'
import { buildPipeFittingGeometry } from './geometry'
import { pipeFittingParametrics } from './parametrics'
import { getPipeFittingPorts } from './ports'
import { PipeFittingNode } from './schema'

/**
 * DWV fittings — minted automatically by the pipe draw tool (corner
 * joints → elbows, body taps → wyes on horizontal drains / sanitary
 * tees on stacks), or click-placed via the tool (armed from the Build
 * tab's DWV Pipe panel). Editable after the fact via the inspector.
 */
export const pipeFittingDefinition: NodeDefinition<typeof PipeFittingNode> = {
  kind: 'pipe-fitting',
  schemaVersion: 1,
  schema: PipeFittingNode,
  category: 'utility',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    fittingType: 'elbow',
    angle: 90,
    diameter: 2,
    diameter2: 2,
    pipeMaterial: 'pvc',
    system: 'waste',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true, cursorAttached: true },
    duplicable: true,
    deletable: true,
  },

  parametrics: pipeFittingParametrics,

  geometry: buildPipeFittingGeometry,
  geometryKey: (n) =>
    JSON.stringify([n.fittingType, n.angle, n.diameter, n.diameter2, n.pipeMaterial, n.system]),

  ports: getPipeFittingPorts,

  floorplan: buildPipeFittingFloorplan,

  // R/T rotate a selected fitting ±45° around the shared active axis —
  // same scheme as duct fittings (the default editor rotate only knows
  // Y; DWV stacks need X/Z). Alt-cycling lives in `./system.tsx`.
  keyboardActions: {
    r: {
      appliesTo: (node) => node.type === 'pipe-fitting',
      run: (node) =>
        useScene.getState().updateNode(node.id, {
          rotation: rotateEulerWorld(
            (node as PipeFittingNode).rotation,
            getRotationAxis(),
            1,
          ),
        }),
    },
    t: {
      appliesTo: (node) => node.type === 'pipe-fitting',
      run: (node) =>
        useScene.getState().updateNode(node.id, {
          rotation: rotateEulerWorld(
            (node as PipeFittingNode).rotation,
            getRotationAxis(),
            -1,
          ),
        }),
    },
  },

  system: { module: () => import('./system') },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place fitting' },
    { key: 'Hover a pipe end', label: 'Snap onto the run' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Alt', label: 'Switch rotation axis (Y → X → Z)' },
    { key: 'Esc', label: 'Exit' },
  ],

  presentation: {
    label: 'Pipe Fitting',
    description: 'DWV joint — elbow bend, 45° wye, or sanitary tee.',
    icon: { kind: 'iconify', name: 'lucide:git-merge' },
    paletteSection: 'structure',
    paletteOrder: 96,
    hidden: true,
  },

  mcp: {
    description:
      'A DWV pipe fitting (elbow, wye, or sanitary tee) with typed ports. Minted automatically at drain joints; position is level-local meters, rotation an XYZ euler.',
  },
}
