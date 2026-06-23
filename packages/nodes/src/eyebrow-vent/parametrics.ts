import type { ParametricDescriptor } from '@pascal-app/core'
import type { EyebrowVentNode } from './schema'

/**
 * Inspector descriptor for the eyebrow vent. Move / Duplicate use the
 * kind-owned ghost-preview flow (see `./move-tool.tsx`), so the panel hosts
 * those actions itself — same pattern as box-vent / cupola.
 */
export const eyebrowVentParametrics: ParametricDescriptor<EyebrowVentNode> = {
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Style',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['scoop', 'half-round', 'slant-box'],
          display: 'segmented',
        },
        { key: 'louverCount', kind: 'number', min: 0, max: 8, step: 1 },
        { key: 'backRatio', kind: 'number', min: 0.15, max: 1, step: 0.05 },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 2, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.2, max: 1.5, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.08, max: 1, step: 0.02 },
      ],
    },
  ],
}
