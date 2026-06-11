import type { NodeDefinition } from '@pascal-app/core'
import { buildPipeSegmentFloorplan } from './floorplan'
import { buildPipeSegmentGeometry } from './geometry'
import { pipeSegmentParametrics } from './parametrics'
import { PipeSegmentNode } from './schema'

/**
 * Phase 4 of the distribution-system effort (the research doc's Phase 2)
 * — DWV plumbing's first kind: the pipe run. The plumbing sibling of
 * `duct-segment`: same polyline + typed-ports model, with SLOPE as the
 * new ingredient (the draw tool drops waste runs ¼"/ft; vents run level
 * or vertical).
 *
 * Deferred to later slices: DWV fittings (wye / sanitary tee / closet
 * bend), fixtures, traps, cleanouts, IPC validators, riser view.
 */
export const pipeSegmentDefinition: NodeDefinition<typeof PipeSegmentNode> = {
  kind: 'pipe-segment',
  schemaVersion: 1,
  schema: PipeSegmentNode,
  category: 'utility',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    path: [
      [0, 0, 0],
      [3, -0.0625, 0],
    ],
    diameter: 2,
    pipeMaterial: 'pvc',
    system: 'waste',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: pipeSegmentParametrics,

  geometry: buildPipeSegmentGeometry,
  geometryKey: (n) => JSON.stringify([n.path, n.diameter, n.pipeMaterial, n.system]),

  // Open run ends as typed ports — system 'waste'/'vent' keeps the DWV
  // network invisible to duct / refrigerant tools and vice versa.
  ports: (n) => {
    if (n.path.length < 2) return []
    const unit = (
      a: readonly [number, number, number],
      b: readonly [number, number, number],
    ): [number, number, number] => {
      const d: [number, number, number] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      const len = Math.hypot(d[0], d[1], d[2])
      return len < 1e-9 ? [1, 0, 0] : [d[0] / len, d[1] / len, d[2] / len]
    }
    const first = n.path[0]!
    const second = n.path[1]!
    const last = n.path[n.path.length - 1]!
    const prev = n.path[n.path.length - 2]!
    return [
      {
        id: 'start',
        position: first,
        direction: unit(first, second),
        diameter: n.diameter,
        system: n.system,
      },
      {
        id: 'end',
        position: last,
        direction: unit(last, prev),
        diameter: n.diameter,
        system: n.system,
      },
    ]
  },

  floorplan: buildPipeSegmentFloorplan,

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Start run' },
    { key: 'Click again', label: 'Place it (waste falls ¼″/ft)' },
    { key: 'Q', label: 'Waste / vent' },
    { key: '[ / ]', label: 'Pipe size down / up' },
    { key: 'Alt + drag', label: 'Vertical stack ↕, click to place' },
    { key: 'Shift', label: 'Free angle' },
    { key: 'Esc', label: 'Cancel start point' },
  ],

  presentation: {
    label: 'DWV Pipe',
    description:
      'Drain / waste / vent pipe run — waste lines fall at ¼″ per foot, vents run level or vertical.',
    icon: { kind: 'iconify', name: 'lucide:droplets' },
    paletteSection: 'structure',
    paletteOrder: 95,
  },

  mcp: {
    description:
      'A DWV (drain-waste-vent) pipe run defined as a polyline. Waste runs slope downward (slope lives in the path Y coordinates); vents run level or vertical. Sized in nominal inches.',
  },
}
