import type { NodeDefinition } from '@pascal-app/core'
import { createPathPointMoveAffordance } from '../shared/path-point-affordance'
import { buildLiquidLineFloorplan } from './floorplan'
import { buildLiquidLineGeometry } from './geometry'
import { liquidLineParametrics } from './parametrics'
import { LiquidLineNode } from './schema'

/**
 * Standalone refrigerant liquid line — the thin bare-copper line broken out of
 * the lineset so it can be drawn on its own. The refrigerant-side sibling of
 * `lineset`: same polyline model and draw tool, snapping onto refrigerant
 * service ports, but a single thin line. Its tool adds a Follow mode that
 * traces an existing lineset's path at an offset.
 *
 * Composition: `def.geometry` only, plus a selection-time path-handle system
 * shared in spirit with the lineset. The framework's `<ParametricNodeRenderer>`
 * mounts an empty group; `<GeometrySystem>` fills it via
 * `buildLiquidLineGeometry` on dirty.
 */
export const liquidLineDefinition: NodeDefinition<typeof LiquidLineNode> = {
  kind: 'liquid-line',
  schemaVersion: 1,
  schema: LiquidLineNode,
  category: 'utility',
  distributionRole: 'run',
  // Directional run: like a wall, drafting sets a direction, so it takes the
  // structural snapping context (grid / lines / angles / off) with a 45° angle
  // lock available as a cyclable mode.
  snapProfile: 'structural',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    path: [
      [0, 0, 0],
      [2, 0, 0],
    ],
    diameter: 0.375,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: liquidLineParametrics,

  geometry: buildLiquidLineGeometry,
  geometryKey: (n) => JSON.stringify([n.path, n.diameter]),

  // Open run ends as typed refrigerant ports — directions point outward along
  // the path tangent so they mate flush onto a service valve. Path coords are
  // already level-local, so no transform is needed.
  ports: (n) => {
    if (n.path.length < 2) return []
    const diameter = n.diameter
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
        diameter,
        system: 'refrigerant',
      },
      {
        id: 'end',
        position: last,
        direction: unit(last, prev),
        diameter,
        system: 'refrigerant',
      },
    ]
  },

  floorplan: buildLiquidLineFloorplan,

  // 2D selection-time path-point handles — the floor-plan twin of the 3D
  // `affordanceTools.selection` handles.
  floorplanAffordances: {
    'move-path-point': createPathPointMoveAffordance('liquid-line'),
  },

  // Selection-time path-point handles (drag to edit a committed run) and the
  // ghost-preview duplicate / move tool (drag-to-place a translucent copy).
  affordanceTools: {
    selection: () => import('./selection'),
    move: () => import('./move-tool'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Start liquid line' },
    { key: 'Click again', label: 'Place it (locked to 45°)' },
    { key: 'Alt + drag', label: 'Go vertical ↕, click to place' },
    { key: 'F', label: 'Follow: trace a lineset' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Liquid Line',
    description:
      'Standalone refrigerant liquid line — a thin bare-copper run; Follow mode traces an existing lineset.',
    icon: { kind: 'url', src: '/icons/lineset.webp' },
    paletteSection: 'structure',
    paletteOrder: 94,
  },

  mcp: {
    description:
      'A standalone refrigerant liquid line defined as a polyline of thin bare copper. Snaps onto refrigerant service ports; can be traced alongside an existing lineset.',
  },
}
