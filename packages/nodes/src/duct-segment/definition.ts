import type { NodeDefinition } from '@pascal-app/core'
import { buildDuctSegmentFloorplan } from './floorplan'
import { buildDuctSegmentGeometry, ductPortDiameterIn } from './geometry'
import { ductSegmentParametrics } from './parametrics'
import { DuctSegmentNode } from './schema'

/**
 * Phase 1 of the HVAC node system — round duct segment as a polyline.
 *
 * Composition: `def.geometry` only. No custom renderer, no per-frame
 * system. The framework's `<ParametricNodeRenderer>` mounts an empty
 * group; `<GeometrySystem>` calls `buildDuctSegmentGeometry` whenever
 * the node is dirty and swaps in the cylinder+sphere meshes.
 *
 * Deferred to later slices:
 *   - Placement tool (polyline draw UX).
 *   - Fittings (elbow / tee / reducer) — needs typed ports first.
 *   - Terminals (registers / diffusers) — needs surface-snapping.
 *   - Equipment (furnace / air-handler / condenser).
 *   - Floor-plan rendering.
 *   - Move / endpoint handles.
 *
 * The node can be created programmatically today via
 * `DuctSegmentNode.parse({ path: [...] })` + `useScene.createNode(...)`.
 */
export const ductSegmentDefinition: NodeDefinition<typeof DuctSegmentNode> = {
  kind: 'duct-segment',
  schemaVersion: 1,
  schema: DuctSegmentNode,
  category: 'utility',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    path: [
      [0, 0, 0],
      [3, 0, 0],
    ],
    shape: 'round',
    diameter: 6,
    width: 14,
    height: 8,
    ductMaterial: 'flex',
    insulationR: 0.5,
    system: 'supply',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: ductSegmentParametrics,

  geometry: buildDuctSegmentGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.path,
      n.shape,
      n.diameter,
      n.width,
      n.height,
      n.ductMaterial,
      n.insulationR,
      n.system,
    ]),

  // Open run ends as typed ports — directions point outward along the
  // path tangent so fittings mate flush. Path coords are already
  // level-local, so no transform is needed.
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
        diameter: ductPortDiameterIn(n),
        system: n.system,
      },
      {
        id: 'end',
        position: last,
        direction: unit(last, prev),
        diameter: ductPortDiameterIn(n),
        system: n.system,
      },
    ]
  },

  floorplan: buildDuctSegmentFloorplan,

  // Selection-time path-point handles (drag to edit a committed run).
  system: { module: () => import('./system') },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Start segment' },
    { key: 'Click again', label: 'Place it (locked to 45°)' },
    { key: 'Shift', label: 'Free angle' },
    { key: 'Alt + drag', label: 'Go vertical ↕, click to place' },
    { key: '[ / ]', label: 'Duct diameter down / up' },
    { key: 'Q', label: 'Round / rect trunk' },
    { key: 'C', label: 'Ceiling / floor height' },
    { key: 'Esc', label: 'Cancel start point' },
  ],

  presentation: {
    label: 'Duct',
    description: 'Round HVAC duct run — polyline of points connected by cylindrical sections.',
    icon: { kind: 'iconify', name: 'lucide:wind' },
    paletteSection: 'structure',
    paletteOrder: 90,
  },

  mcp: {
    description:
      'An HVAC duct run defined as a polyline — round (branches) or rect (trunks/plenums). Supply or return, with configurable size, material, and external insulation.',
  },
}
