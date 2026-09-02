import type { ParametricDescriptor } from '@pascal-app/core'
import type { CupolaNode } from './schema'

/**
 * Inspector descriptor for the cupola. Move / Duplicate use the kind-owned
 * ghost-preview flow (see `./move-tool.tsx`), so the panel hosts those
 * actions itself — same pattern as box-vent.
 */
export const cupolaParametrics: ParametricDescriptor<CupolaNode> = {
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Style',
      labelKey: 'common.style',
      fields: [
        {
          key: 'roofStyle',
          kind: 'enum',
          options: ['dome', 'pyramid'],
          optionLabelKeys: {
            "dome": "nodes.cupola.dome",
            "pyramid": "nodes.cupola.pyramid"
          },
          display: 'segmented',
        },
        { key: 'finial', kind: 'boolean' },
      ],
    },
    {
      label: 'Dimensions',
      labelKey: 'common.dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 1000, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.3, max: 1000, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.4, max: 1000, step: 0.05 },
      ],
    },
  ],
}
