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
      fields: [{ key: 'height', kind: 'number', unit: 'm', min: 1.5, max: 6, step: 0.05 }],
    },
  ],
  customPanel: () => import('./panel'),
}
