import type { ParametricDescriptor, RoadNode } from '@pascal-app/core'
import { RoadSurfaceKindField } from './surface-kind-field'

export const roadParametrics: ParametricDescriptor<RoadNode> = {
  groups: [
    {
      label: 'Type',
      fields: [{ key: 'surfaceKind', kind: 'custom', component: RoadSurfaceKindField }],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.5, max: 30, step: 0.1 },
        { key: 'thickness', kind: 'number', unit: 'm', min: 0.01, max: 0.5, step: 0.01 },
        { key: 'elevation', kind: 'number', unit: 'm', min: -1, max: 2, step: 0.01 },
        { key: 'curveOffset', kind: 'number', unit: 'm', min: -100, max: 100, step: 0.1 },
      ],
    },
    {
      label: 'Lane markings',
      fields: [
        { key: 'laneCount', kind: 'number', min: 1, max: 8, step: 1 },
        { key: 'showLaneMarkings', kind: 'boolean' },
      ],
    },
    {
      label: 'Appearance',
      fields: [{ key: 'markingColor', kind: 'color', visibleIf: (node) => node.showLaneMarkings }],
    },
  ],
}
