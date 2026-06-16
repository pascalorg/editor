import type { ConformalStripNode, ParametricDescriptor } from '@pascal-app/core'

export const conformalStripParametrics: ParametricDescriptor<ConformalStripNode> = {
  groups: [
    {
      label: 'Surface',
      fields: [
        { key: 'side', kind: 'enum', options: ['left', 'right'] },
        { key: 'xStart', kind: 'number', min: -50, max: 50, step: 0.05, unit: 'm' },
        { key: 'xEnd', kind: 'number', min: -50, max: 50, step: 0.05, unit: 'm' },
        { key: 'verticalOffset', kind: 'number', min: -20, max: 20, step: 0.01, unit: 'm' },
        { key: 'surfaceRadiusY', kind: 'number', min: 0.001, max: 20, step: 0.01, unit: 'm' },
        { key: 'surfaceRadiusZ', kind: 'number', min: 0.001, max: 20, step: 0.01, unit: 'm' },
        { key: 'surfaceLength', kind: 'number', min: 0.001, max: 100, step: 0.05, unit: 'm' },
        { key: 'endTaper', kind: 'number', min: 0, max: 0.95, step: 0.01 },
      ],
    },
    {
      label: 'Strip',
      fields: [
        { key: 'width', kind: 'number', min: 0.001, max: 20, step: 0.005, unit: 'm' },
        { key: 'thickness', kind: 'number', min: 0.0005, max: 1, step: 0.001, unit: 'm' },
        { key: 'segments', kind: 'number', min: 1, max: 128, step: 1 },
        { key: 'widthSegments', kind: 'number', min: 1, max: 16, step: 1 },
      ],
    },
  ],
}
