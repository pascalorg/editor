import type { CabinetModuleNode, CabinetNode, ParametricDescriptor } from '@pascal-app/core'

export const cabinetParametrics: ParametricDescriptor<CabinetNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 3, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.3, max: 1.2, step: 0.01 },
        { key: 'carcassHeight', kind: 'number', unit: 'm', min: 0.4, max: 2.4, step: 0.01 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
  customPanel: () => import('./panel'),
}

export const cabinetModuleParametrics: ParametricDescriptor<CabinetModuleNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 3, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.3, max: 1.2, step: 0.01 },
        { key: 'carcassHeight', kind: 'number', unit: 'm', min: 0.4, max: 2.4, step: 0.01 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
  customPanel: () => import('./panel'),
}
