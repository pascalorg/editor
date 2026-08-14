import type { NodeDefinition } from '@pascal-app/core/registry'
import { buildBeamBody } from './geometry'
import { beamParametrics } from './parametrics'
import { BeamNode } from './schema'

/**
 * A horizontal castable element — two side shutters tied across the width, a
 * soffit under it propped off the floor below, and a stop-end at each end.
 *
 * The beam's own `geometry` draws only its concrete body: the shutter is built
 * by the formwork assemblies the beam hosts, the same attach path walls and
 * slabs use, so drawing it here too would render every shutter twice.
 */
export const beamDefinition: NodeDefinition<typeof BeamNode> = {
  kind: 'beam',
  snapProfile: 'structural',
  schemaVersion: 1,
  category: 'structure',
  schema: BeamNode,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [4, 0],
    width: 0.3,
    depth: 0.6,
    elevation: 3,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Generic 3D translate-on-XZ via `MoveRegistryNodeTool` (grid snap + the
    // mode-driven snapping the overhaul standardised). Endpoint drag would be
    // nicer than translate-and-re-draw, but the beam is a centreline element
    // with no bespoke mover yet, and the generic move is what makes a placed
    // beam adjustable at all.
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
    },
  },

  geometry: buildBeamBody,

  parametrics: beamParametrics,

  // Two-click centreline draw, the wall convention a beam runs on.
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Start beam' },
    { key: 'Left click again', label: 'End beam' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Beam',
    icon: { kind: 'iconify', name: 'lucide:rows-3' },
  },

  mcp: {
    description:
      'A horizontal castable element: two side shutters tied across the width, a propped soffit under it, and a stop-end at each end. Runs on a centreline like a wall (start/end in the level plane); width is the dimension across the centreline and depth is the vertical dimension the side shutters span. Nothing is formed until formworkType names a system, and the shutter is attached as a formwork-assembly child like any other castable host.',
  },
}
