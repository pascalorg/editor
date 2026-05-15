import type { ParametricDescriptor } from '@pascal-app/core'
import type { CeilingNode } from './schema'

/**
 * Inspector descriptor for ceiling. Polygon + holes are edited via the
 * floor-plan boundary / hole editors — not number inputs. Inspector
 * exposes only the per-instance scalar (height).
 */
export const ceilingParametrics: ParametricDescriptor<CeilingNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [{ key: 'height', kind: 'number', unit: 'm', min: 1.5, max: 6, step: 0.05 }],
    },
  ],
}
