import type { ParametricDescriptor } from '@pascal-app/core'
import type { ShelfNode } from './schema'

/**
 * Inspector descriptor for the parametric shelf. Drives both the
 * auto-derived inspector UI and the AI/MCP `create_shelf` /
 * `update_shelf` tools with bounded JSON-schema parameters.
 *
 * Fields are grouped by intent: Style first (what kind of shelf), then
 * Topology (rows / columns / back / sides / bottom + wall-shelf bracket
 * style), then Dimensions. Surface material is paint-tray driven (same
 * flow as walls / slabs / stairs) and intentionally not surfaced here.
 */
export const shelfParametrics: ParametricDescriptor<ShelfNode> = {
  groups: [
    {
      label: 'Style',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['wall-shelf', 'bookshelf', 'open-rack', 'cubby'],
        },
      ],
    },
    {
      label: 'Topology',
      fields: [
        { key: 'rows', kind: 'number', min: 1, max: 8, step: 1 },
        // Columns only meaningful for kinds with vertical dividers.
        {
          key: 'columns',
          kind: 'number',
          min: 1,
          max: 6,
          step: 1,
          visibleIf: (n) => n.style === 'bookshelf' || n.style === 'cubby',
        },
        // Sides toggle only applies to bookshelf (cubby always on, the
        // others use their own post structure).
        {
          key: 'withSides',
          kind: 'boolean',
          visibleIf: (n) => n.style === 'bookshelf',
        },
        // Back toggle only applies to bookshelf and open-rack (cubby
        // always has a back, wall-shelf has no back).
        {
          key: 'withBack',
          kind: 'boolean',
          visibleIf: (n) => n.style === 'bookshelf' || n.style === 'open-rack',
        },
        // Bottom toggle only applies to bookshelf and cubby — closes
        // the lowest cell with a floor board so items can host there.
        {
          key: 'withBottom',
          kind: 'boolean',
          visibleIf: (n) => n.style === 'bookshelf' || n.style === 'cubby',
        },
        // Bracket style only matters for wall-shelf — the other styles
        // structure themselves through sides / posts / dividers.
        {
          key: 'bracketStyle',
          kind: 'enum',
          options: ['minimal', 'industrial', 'hidden'],
          visibleIf: (n) => n.style === 'wall-shelf',
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 3.0, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.1, max: 1.0, step: 0.05 },
        { key: 'thickness', kind: 'number', unit: 'm', min: 0.01, max: 0.1, step: 0.005 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.05, max: 2.5, step: 0.05 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}
