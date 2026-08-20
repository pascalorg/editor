import type { ParametricDescriptor } from '@pascal-app/core'
import type { GrassNode } from './grass-schema'

/** Inspector for a placed grass tuft — rendered for free by the host's
 * `ParametricInspector` from this descriptor. */
export const grassParametrics: ParametricDescriptor<GrassNode> = {
  groups: [
    {
      label: 'Grass',
      fields: [
        { key: 'preset', kind: 'enum', options: ['meadow', 'fescue', 'reed'] },
        { key: 'height', kind: 'number', unit: 'm', min: 0.1, max: 2, step: 0.05 },
        { key: 'bladeColor', kind: 'color' },
        { key: 'seed', kind: 'number', min: 0, max: 9999, step: 1 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}
