import type { ParametricDescriptor } from '@pascal-app/core'
import type { SectionPlaneNode } from './schema'

export const sectionPlaneParametrics: ParametricDescriptor<SectionPlaneNode> = {
  groups: [
    {
      label: 'Cut',
      fields: [
        { key: 'active', kind: 'boolean' },
        { key: 'flipped', kind: 'boolean' },
      ],
    },
    {
      // Position only. `rotation` is deliberately absent: the generic `vec3`
      // field hardcodes a metre unit, so an euler would render as "0.00m".
      // Rotating is done with the in-scene rotate gizmo until that field grows
      // a unit override.
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
    {
      label: 'Display',
      fields: [{ key: 'size', kind: 'number', unit: 'm', min: 1, max: 200, step: 0.5 }],
    },
  ],
}
