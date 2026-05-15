import type { ParametricDescriptor } from '@pascal-app/core'
import type { SlabNode } from './schema'

/**
 * Inspector descriptor for slab. Polygon + holes are edited via the
 * floor-plan boundary / hole editors — not number inputs. The inspector
 * exposes only the per-instance scalars (elevation + auto-from-walls
 * toggle).
 */
export const slabParametrics: ParametricDescriptor<SlabNode> = {
  groups: [
    {
      label: 'Elevation',
      fields: [{ key: 'elevation', kind: 'number', unit: 'm', min: 0.02, max: 1, step: 0.01 }],
    },
  ],
}
