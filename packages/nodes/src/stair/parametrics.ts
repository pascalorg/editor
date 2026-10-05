import type { ParametricDescriptor, StairNode } from '@pascal-app/core'

export const stairParametrics: ParametricDescriptor<StairNode> = {
  groups: [
    {
      label: 'Type',
      fields: [
        {
          key: 'stairType',
          kind: 'enum',
          options: ['straight', 'curved', 'spiral'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Opening',
      fields: [
        { key: 'fromLevelId', kind: 'ref', label: 'From level', refKind: 'level' },
        { key: 'toLevelId', kind: 'ref', label: 'To level', refKind: 'level' },
        {
          key: 'slabOpeningMode',
          kind: 'enum',
          label: 'Auto cutout',
          options: ['none', 'destination'],
          display: 'segmented',
        },
        {
          key: 'openingOffset',
          kind: 'number',
          label: 'Opening offset',
          unit: 'm',
          min: 0,
          max: 0.5,
          step: 0.01,
          visibleIf: (node) => node.slabOpeningMode === 'destination',
        },
      ],
    },
    {
      label: 'Geometry',
      fields: [
        {
          key: 'width',
          kind: 'number',
          unit: 'm',
          min: 0.4,
          max: 1000,
          step: 0.05,
          visibleIf: (node) => node.stairType !== 'straight',
        },
        {
          key: 'stepCount',
          kind: 'number',
          label: 'Steps',
          min: 2,
          max: 32,
          step: 1,
          visibleIf: (node) => node.stairType !== 'straight',
        },
        {
          key: 'fillToFloor',
          kind: 'boolean',
          label: 'Fill to floor',
          visibleIf: (node) => node.stairType === 'curved',
        },
        {
          key: 'thickness',
          kind: 'number',
          unit: 'm',
          min: 0.02,
          max: 1000,
          step: 0.01,
          visibleIf: (node) => node.stairType === 'spiral' || !node.fillToFloor,
        },
        {
          key: 'innerRadius',
          kind: 'number',
          label: 'Inner radius',
          unit: 'm',
          min: 0.05,
          max: 1000,
          step: 0.05,
          visibleIf: (node) => node.stairType !== 'straight',
        },
        {
          key: 'sweepAngle',
          kind: 'number',
          label: 'Sweep (rad)',
          min: -Math.PI * 4,
          max: Math.PI * 4,
          step: Math.PI / 180,
          visibleIf: (node) => node.stairType !== 'straight',
        },
        {
          key: 'showCenterColumn',
          kind: 'boolean',
          label: 'Center column',
          visibleIf: (node) => node.stairType === 'spiral',
        },
        {
          key: 'showStepSupports',
          kind: 'boolean',
          label: 'Step supports',
          visibleIf: (node) => node.stairType === 'spiral',
        },
        {
          key: 'topLandingMode',
          kind: 'enum',
          label: 'Top landing',
          options: ['none', 'integrated'],
          display: 'segmented',
          visibleIf: (node) => node.stairType === 'spiral',
        },
        {
          key: 'topLandingDepth',
          kind: 'number',
          label: 'Landing depth',
          unit: 'm',
          min: 0.3,
          max: 1000,
          step: 0.05,
          visibleIf: (node) => node.stairType === 'spiral' && node.topLandingMode === 'integrated',
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
    {
      label: 'Railing',
      fields: [
        {
          key: 'railingMode',
          kind: 'enum',
          options: ['none', 'left', 'right', 'both'],
        },
        {
          key: 'railingHeight',
          kind: 'number',
          label: 'Railing height',
          unit: 'm',
          min: 0.7,
          max: 1.4,
          step: 0.02,
          visibleIf: (node) => node.railingMode !== 'none',
        },
      ],
    },
  ],
  derive: (next, patch, previous) =>
    patch.stairType === 'spiral' && previous?.stairType !== 'spiral'
      ? {
          position: [next.position[0], 0, next.position[2]],
          sweepAngle: (400 * Math.PI) / 180,
        }
      : {},
  customPanel: () => import('./panel'),
}
