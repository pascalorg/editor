import type { NodeDefinition } from '@pascal-app/core'
import { buildPlumbingFixtureFloorplan } from './floorplan'
import { buildPlumbingFixtureGeometry } from './geometry'
import { plumbingFixtureParametrics } from './parametrics'
import { getPlumbingFixturePorts } from './ports'
import { PlumbingFixtureNode } from './schema'

/**
 * DWV plumbing's start points — fixtures whose drain rough-ins are
 * waste ports the pipe tool draws runs from. Fixture-unit values (IPC
 * DFU) come from `spec.ts` and feed the system summary; the sizing
 * validators in a later slice read the same table.
 */
export const plumbingFixtureDefinition: NodeDefinition<typeof PlumbingFixtureNode> = {
  kind: 'plumbing-fixture',
  schemaVersion: 1,
  schema: PlumbingFixtureNode,
  category: 'utility',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    fixtureType: 'toilet',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
  },

  parametrics: plumbingFixtureParametrics,

  geometry: buildPlumbingFixtureGeometry,
  geometryKey: (n) => JSON.stringify([n.fixtureType]),

  ports: getPlumbingFixturePorts,

  floorplan: buildPlumbingFixtureFloorplan,

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place fixture' },
    { key: 'Q', label: 'Cycle fixture type' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Shift', label: 'Smooth (no grid snap)' },
    { key: 'Esc', label: 'Exit' },
  ],

  presentation: {
    label: 'Fixture',
    description:
      'Plumbing fixture — toilet, lavatory, kitchen sink, tub, or washer. Drain runs start at its waste rough-in.',
    icon: { kind: 'iconify', name: 'lucide:bath' },
    paletteSection: 'structure',
    paletteOrder: 97,
  },

  mcp: {
    description:
      'A plumbing fixture (toilet, lavatory, kitchen sink, tub/shower, or clothes washer) with a waste rough-in port. Position is level-local meters; rotation is yaw radians. DFU and drain size derive from the fixture type.',
  },
}
