import type { ParametricDescriptor } from '@pascal-app/core'
import type { FlowerNode } from './flower-schema'

/** Inspector for a placed flower — rendered for free by the host's
 * `ParametricInspector` from this descriptor. */
export const flowerParametrics: ParametricDescriptor<FlowerNode> = {
  groups: [
    {
      label: 'Flower',
      fields: [
        { key: 'preset', kind: 'enum', options: ['daisy', 'tulip', 'lavender'] },
        { key: 'height', kind: 'number', unit: 'm', min: 0.2, max: 2, step: 0.05 },
        { key: 'petalColor', kind: 'color' },
        { key: 'seed', kind: 'number', min: 0, max: 9999, step: 1 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}
