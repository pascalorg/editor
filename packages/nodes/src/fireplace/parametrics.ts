import type { ParametricDescriptor } from '@pascal-app/core'
import type { FireplaceNode } from './schema'

export const fireplaceParametrics: ParametricDescriptor<FireplaceNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.6, max: 4, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.8, max: 4, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.3, max: 1.5, step: 0.05 },
      ],
    },
    {
      label: 'Firebox',
      fields: [
        { key: 'fireboxWidth', kind: 'number', unit: 'm', min: 0.3, max: 3, step: 0.05 },
        { key: 'fireboxHeight', kind: 'number', unit: 'm', min: 0.3, max: 3, step: 0.05 },
        { key: 'fireboxDepth', kind: 'number', unit: 'm', min: 0.2, max: 1.2, step: 0.05 },
        { key: 'fireboxSillHeight', kind: 'number', unit: 'm', min: 0, max: 1.5, step: 0.05 },
      ],
    },
    {
      label: 'Mantel',
      fields: [
        { key: 'mantelHeight', kind: 'number', unit: 'm', min: 0.05, max: 0.5, step: 0.01 },
        { key: 'mantelOverhang', kind: 'number', unit: 'm', min: 0, max: 0.3, step: 0.01 },
        { key: 'mantelThickness', kind: 'number', unit: 'm', min: 0.03, max: 0.2, step: 0.01 },
        { key: 'mantelWidth', kind: 'number', unit: 'm', min: 0, max: 1, step: 0.01 },
      ],
    },
    {
      label: 'Hearth',
      fields: [
        { key: 'hearthDepth', kind: 'number', unit: 'm', min: 0, max: 0.8, step: 0.05 },
        { key: 'hearthHeight', kind: 'number', unit: 'm', min: 0.02, max: 0.2, step: 0.01 },
        { key: 'hearthWidth', kind: 'number', unit: 'm', min: 0, max: 1.5, step: 0.05 },
      ],
    },
    {
      label: 'Fire',
      fields: [
        { key: 'fire', kind: 'enum', options: ['none', 'small', 'medium', 'large', 'roaring'] },
        { key: 'fireColor', kind: 'enum', options: ['orange', 'amber', 'blue', 'white'] },
      ],
    },
    {
      label: 'Style',
      fields: [
        { key: 'style', kind: 'enum', options: ['wall', 'freestanding', 'corner', 'double-sided'] },
        { key: 'cornerAngle', kind: 'number', unit: '°', min: 30, max: 90, step: 1 },
      ],
    },
  ],
}
