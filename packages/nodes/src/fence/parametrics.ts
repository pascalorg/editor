import {
  clampFencePicketRailProjection,
  isSplineFence,
  type ParametricDescriptor,
} from '@pascal-app/core'
import {
  FenceCurveEditor,
  FenceLengthEditor,
  FencePathEditor,
  FencePatternInfo,
  FencePicketRailProjectionEditor,
  FenceSurfaceEditor,
} from './inspector-editors'
import type { FenceNode } from './schema'

export const fenceParametrics: ParametricDescriptor<FenceNode> = {
  groups: [
    {
      label: 'Style',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['slat', 'rail', 'privacy', 'horizontal', 'picket'],
          display: 'segmented',
        },
        {
          key: 'baseStyle',
          kind: 'enum',
          options: ['grounded', 'floating'],
          display: 'segmented',
        },
        { key: 'showInfill', kind: 'boolean' },
        {
          key: 'infillPlacement',
          kind: 'enum',
          options: ['center', 'front', 'back'],
          visibleIf: (n) => n.showInfill,
        },
      ],
    },
    {
      label: 'Surface',
      fields: [
        {
          key: 'surfaceMode',
          kind: 'custom',
          component: FenceSurfaceEditor,
          visibleIf: (n) => isSplineFence(n) || Math.abs(n.curveOffset ?? 0) > 1e-4,
        },
        {
          key: 'transitionMode',
          label: 'Height transitions',
          kind: 'enum',
          options: ['slope', 'step', 'break'],
          visibleIf: (n) => isSplineFence(n) || Math.abs(n.curveOffset ?? 0) > 1e-4,
        },
        {
          key: 'transitionWidth',
          label: 'Transition length',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 1000,
          step: 0.05,
          visibleIf: (n) =>
            (isSplineFence(n) || Math.abs(n.curveOffset ?? 0) > 1e-4) &&
            n.transitionMode === 'slope' &&
            n.surfaceMode !== 'level',
        },
        {
          key: 'supportOffset',
          label: 'Vertical offset',
          kind: 'number',
          unit: 'm',
          step: 0.01,
        },
      ],
    },
    {
      label: 'Pattern distribution',
      fields: [
        {
          key: 'postSpacing',
          label: 'Post / infill spacing',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 1000,
          step: 0.01,
        },
        {
          key: 'picketSpacing',
          label: 'Picket spacing',
          kind: 'number',
          unit: 'm',
          min: 0.06,
          max: 1000,
          step: 0.01,
          visibleIf: (n) => n.style === 'picket',
        },
        {
          key: 'patternDistribution',
          label: 'Placement',
          kind: 'enum',
          options: ['automatic', 'fixed-spacing', 'fixed-count', 'maximum-spacing', 'equal-fit'],
        },
        {
          key: 'patternAlignment',
          label: 'Align from',
          kind: 'enum',
          options: ['start', 'center', 'end'],
          visibleIf: (n) =>
            n.patternDistribution === 'fixed-spacing' && n.patternRemainder === 'leave',
        },
        {
          key: 'patternRemainder',
          label: 'Extra length',
          kind: 'enum',
          options: ['leave', 'spread'],
          visibleIf: (n) => n.patternDistribution === 'fixed-spacing',
        },
        {
          key: 'patternCount',
          label: 'Items per span',
          kind: 'number',
          min: 1,
          max: 500,
          step: 1,
          visibleIf: (n) => n.patternDistribution === 'fixed-count',
        },
        {
          key: 'patternInfo',
          kind: 'custom',
          component: FencePatternInfo,
          visibleIf: (n) => n.patternDistribution !== 'automatic',
        },
      ],
    },
    {
      label: 'Curve points',
      fields: [
        {
          key: 'path',
          kind: 'custom',
          component: FencePathEditor,
          visibleIf: (n) => isSplineFence(n),
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        // Length / Curve drive start/end + the single sagitta — meaningless
        // for a multi-point spline fence, so hide them when `path` is set.
        {
          key: 'length',
          kind: 'custom',
          component: FenceLengthEditor,
          visibleIf: (n) => !isSplineFence(n),
        },
        {
          key: 'curve',
          kind: 'custom',
          component: FenceCurveEditor,
          visibleIf: (n) => !isSplineFence(n),
        },
        { key: 'height', kind: 'number', unit: 'm', min: 0.4, max: 1000, step: 0.05 },
        { key: 'thickness', kind: 'number', unit: 'm', min: 0.03, max: 1000, step: 0.005 },
      ],
    },
    {
      label: 'Structure',
      fields: [
        { key: 'baseHeight', kind: 'number', unit: 'm', min: 0.04, max: 1, step: 0.01 },
        { key: 'topRailHeight', kind: 'number', unit: 'm', min: 0.01, max: 0.25, step: 0.005 },
        {
          key: 'picketTop',
          kind: 'enum',
          options: ['flat', 'pointed', 'rounded', 'dog-ear'],
          visibleIf: (n) => n.style === 'picket',
        },
        {
          key: 'picketWidth',
          kind: 'number',
          unit: 'm',
          min: 0.02,
          max: 1000,
          step: 0.005,
          visibleIf: (n) => n.style === 'picket',
        },
        {
          key: 'picketRailCount',
          kind: 'number',
          min: 2,
          max: 3,
          step: 1,
          visibleIf: (n) => n.style === 'picket',
        },
        {
          key: 'picketProfile',
          kind: 'enum',
          options: ['level', 'arched', 'scalloped', 'alternating'],
          visibleIf: (n) => n.style === 'picket',
        },
        {
          key: 'picketVariation',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1000,
          step: 0.01,
          visibleIf: (n) => n.style === 'picket' && n.picketProfile !== 'level',
        },
        {
          key: 'picketRailProjection',
          kind: 'custom',
          component: FencePicketRailProjectionEditor,
          visibleIf: (n) => n.style === 'picket',
        },
        { key: 'postSize', kind: 'number', unit: 'm', min: 0.01, max: 0.4, step: 0.005 },
        {
          // Dropdown (not segmented) so the inspector renders its "Post Cap"
          // label — a bare segmented `None / Flat / Pyramid` switch reads
          // contextless.
          key: 'postCap',
          kind: 'enum',
          options: ['none', 'flat', 'pyramid'],
          visibleIf: (n) => n.style === 'horizontal' || n.style === 'picket',
        },
        {
          key: 'slatGap',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.1,
          step: 0.002,
          visibleIf: (n) => n.style === 'horizontal',
        },
        { key: 'groundClearance', kind: 'number', unit: 'm', min: 0, max: 0.6, step: 0.005 },
        {
          key: 'picketTopClearance',
          label: 'Top clearance',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1000,
          step: 0.01,
          visibleIf: (n) => n.style === 'picket',
        },
        { key: 'edgeInset', kind: 'number', unit: 'm', min: 0.005, max: 0.25, step: 0.005 },
      ],
    },
  ],
  derive: (next) => ({
    picketRailProjection: clampFencePicketRailProjection(next.picketRailProjection, next.postSize),
  }),
}
