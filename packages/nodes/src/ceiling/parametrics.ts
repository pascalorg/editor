import type { ParametricDescriptor } from '@pascal-app/core'
import type { CeilingNode } from './schema'

/**
 * Inspector descriptor for ceiling.
 *
 * Mounts the kind-owned `<CeilingPanel>` via `customPanel` — same
 * rationale as slab (holes list + height presets need richer field
 * kinds before this can collapse into pure parametrics).
 */
export const ceilingParametrics: ParametricDescriptor<CeilingNode> = {
  groups: [
    {
      label: 'Dimensions',
      labelKey: 'common.dimensions',
      fields: [{ key: 'height', kind: 'number', unit: 'm', min: 0.1, max: 1000, step: 0.05 }],
    },
  ],
  customPanel: () => import('./panel'),
}
