import type { ParametricDescriptor } from '@pascal-app/core'
import type { ShelfNode } from './schema'

/**
 * Inspector descriptor for the parametric shelf. Drives both the auto-derived
 * inspector UI (Phase 4) and the AI/MCP `create_shelf` / `update_shelf` tools
 * with bounded JSON-schema parameters (also Phase 4).
 */
export const shelfParametrics: ParametricDescriptor<ShelfNode> = {
  groups: [
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
      label: 'Style',
      fields: [
        { key: 'bracketStyle', kind: 'enum', options: ['minimal', 'industrial', 'hidden'] },
        { key: 'color', kind: 'color' },
      ],
    },
  ],
}
