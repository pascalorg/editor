import type { ParametricDescriptor } from '@pascal-app/core'
import { isPipeNearlyVertical } from '@pascal-app/core'
import { PL, S } from '../i18n/panel-labels'
import { PipeCurveEditor, PipeLengthEditor } from './inspector-editors'
import type { PipeNode } from './schema'

export const pipeParametrics: ParametricDescriptor<PipeNode> = {
  groups: [
    {
      label: S.dimensions(),
      fields: [
        { key: 'length', kind: 'custom', component: PipeLengthEditor },
        { key: 'curve', kind: 'custom', component: PipeCurveEditor },
        { key: 'diameter', kind: 'number', unit: 'm', min: 0.02, max: 2, step: 0.01 },
        { key: 'elevation', kind: 'number', unit: 'm', min: -2, max: 30, step: 0.05 },
        { key: 'rotate', kind: 'number', unit: '°', min: 0, max: 90, step: 1 },
      ],
    },
    {
      label: PL.appearance(),
      fields: [
        { key: 'color', kind: 'color' },
        { key: 'insulated', kind: 'boolean' },
        {
          key: 'insulationThickness',
          kind: 'number',
          unit: 'm',
          min: 0.01,
          max: 0.3,
          step: 0.005,
          visibleIf: (node) => node.insulated,
        },
        {
          key: 'showHangers',
          kind: 'boolean',
          visibleIf: (node) => !isPipeNearlyVertical(node),
        },
        {
          key: 'hangerSpacing',
          kind: 'number',
          unit: 'm',
          min: 0.5,
          max: 10,
          step: 0.1,
          visibleIf: (node) => node.showHangers && !isPipeNearlyVertical(node),
        },
      ],
    },
  ],
}
