import type { ParametricDescriptor, PipeFittingNode } from '@pascal-app/core'

export const pipeFittingParametrics: ParametricDescriptor<PipeFittingNode> = {
  groups: [
    {
      label: 'Fitting',
      fields: [
        {
          key: 'fittingKind',
          kind: 'enum',
          options: ['elbow', 'tee', 'cross', 'flange', 'valve'],
          display: 'segmented',
        },
        {
          key: 'angleDegrees',
          kind: 'number',
          min: 15,
          max: 180,
          step: 5,
          visibleIf: (node) => node.fittingKind === 'elbow',
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'diameter', kind: 'number', unit: 'm', min: 0.02, max: 2, step: 0.01 },
        {
          key: 'bendRadiusMultiplier',
          kind: 'number',
          min: 1,
          max: 8,
          step: 0.25,
          visibleIf: (node) => node.fittingKind === 'elbow',
        },
        {
          key: 'branchLength',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 5,
          step: 0.05,
          visibleIf: (node) => node.fittingKind === 'tee' || node.fittingKind === 'cross',
        },
        {
          key: 'length',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 5,
          step: 0.05,
          visibleIf: (node) =>
            node.fittingKind === 'flange' ||
            node.fittingKind === 'valve',
        },
        {
          key: 'flangeOuterDiameter',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 4,
          step: 0.01,
          visibleIf: (node) => node.fittingKind === 'flange' || node.fittingKind === 'valve',
        },
        {
          key: 'flangeThickness',
          kind: 'number',
          unit: 'm',
          min: 0.01,
          max: 1,
          step: 0.01,
          visibleIf: (node) => node.fittingKind === 'flange' || node.fittingKind === 'valve',
        },
        {
          key: 'boltCount',
          kind: 'number',
          min: 0,
          max: 32,
          step: 1,
          visibleIf: (node) => node.fittingKind === 'flange',
        },
        {
          key: 'boltDiameter',
          kind: 'number',
          unit: 'm',
          min: 0.005,
          max: 0.2,
          step: 0.005,
          visibleIf: (node) => node.fittingKind === 'flange',
        },
        {
          key: 'valveStyle',
          kind: 'enum',
          options: ['placeholder', 'gate', 'ball', 'butterfly'],
          visibleIf: (node) => node.fittingKind === 'valve',
        },
      ],
    },
    {
      label: 'Process',
      fields: [
        { key: 'medium', kind: 'enum', options: ['steam', 'condensate', 'water'] },
        { key: 'pressureKpa', kind: 'number', min: 0, max: 5000, step: 10 },
        { key: 'temperatureC', kind: 'number', min: -50, max: 600, step: 5 },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        { key: 'color', kind: 'color' },
        { key: 'insulated', kind: 'boolean' },
        {
          key: 'insulationThickness',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1,
          step: 0.01,
          visibleIf: (node) => node.insulated,
        },
      ],
    },
  ],
}
