import {
  type ParametricDescriptor,
  planStairFlightHeightEdit,
  type StairSegmentNode,
  useScene,
} from '@pascal-app/core'

import { StairSegmentConstructionField } from '../stair/construction-controls'

export const stairSegmentParametrics: ParametricDescriptor<StairSegmentNode> = {
  groups: [
    {
      label: 'Construction',
      fields: [{ key: 'construction', kind: 'custom', component: StairSegmentConstructionField }],
    },
    {
      label: 'Type',
      fields: [
        {
          key: 'segmentType',
          kind: 'enum',
          options: ['stair', 'landing'],
          display: 'segmented',
        },
        {
          key: 'attachmentSide',
          kind: 'enum',
          label: 'Attachment',
          options: ['front', 'left', 'right'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.001, step: 0.1 },
        {
          key: 'length',
          kind: 'number',
          unit: 'm',
          min: 0.001,
          step: 0.1,
          visibleIf: (node) => !node.winder,
        },
        {
          key: 'height',
          kind: 'number',
          unit: 'm',
          min: 0.001,
          step: 0.1,
          visibleIf: (node) => node.segmentType === 'stair',
        },
        {
          key: 'stepCount',
          kind: 'number',
          label: 'Steps',
          min: 2,
          step: 1,
          visibleIf: (node) => node.segmentType === 'stair',
        },
      ],
    },
    {
      label: 'Structure',
      fields: [
        { key: 'fillToFloor', kind: 'boolean', label: 'Fill to floor' },
        {
          key: 'thickness',
          kind: 'number',
          unit: 'm',
          min: 0.001,
          step: 0.05,
          visibleIf: (node) => !node.fillToFloor,
        },
      ],
    },
    {
      label: 'Position',
      fields: [
        { key: 'position', kind: 'vec3' },
        {
          key: 'rotation',
          kind: 'number',
          label: 'Rotation (rad)',
          min: -Math.PI,
          max: Math.PI,
          step: Math.PI / 36,
        },
      ],
    },
  ],
  derive: (_next, patch, previous) => {
    if (!(patch.segmentType && patch.segmentType !== previous?.segmentType)) return {}
    return patch.segmentType === 'landing'
      ? { height: 0, length: 1, stepCount: 0, winder: undefined }
      : { height: 2.5, length: 3, stepCount: 10 }
  },
  reconcile: (previous, next, nodes) =>
    next.segmentType === 'stair' && next.height !== previous.height
      ? planStairFlightHeightEdit(next, next.height, nodes ?? useScene.getState().nodes).slice(1)
      : [],
  customPanel: () => import('./panel'),
}
