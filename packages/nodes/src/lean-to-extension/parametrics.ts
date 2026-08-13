import type { LeanToExtensionNode, ParametricDescriptor } from '@pascal-app/core'
import { MIN_LEAN_TO_POST_HEIGHT, resolveLeanToLayout } from './layout'

export const leanToExtensionParametrics: ParametricDescriptor<LeanToExtensionNode> = {
  derive: (_next, patch) => ({
    ...(patch.connectionMode === 'manual'
      ? {
          hostRoofId: undefined,
          hostRoofSegmentId: undefined,
          hostRoofEdge: undefined,
          connectionInset: 0,
        }
      : {}),
    ...('roofThickness' in patch || 'shingleThickness' in patch
      ? { matchHostRoofStructure: false }
      : {}),
    ...('span' in patch ? { autoSpan: false } : {}),
  }),
  groups: [
    {
      label: 'Roof',
      fields: [
        {
          key: 'connectionMode',
          kind: 'enum',
          options: ['auto', 'manual'],
          display: 'segmented',
        },
        { key: 'autoSpan', kind: 'boolean' },
        {
          key: 'span',
          kind: 'number',
          unit: 'm',
          min: 0.5,
          max: 100,
          step: 0.1,
        },
        {
          key: 'projection',
          kind: 'number',
          unit: 'm',
          min: 0.5,
          max: 10,
          step: 0.1,
        },
        {
          key: 'highEdgeHeight',
          kind: 'number',
          unit: 'm',
          min: 0.8,
          max: 10,
          step: 0.05,
          visibleIf: (node) => node.connectionMode === 'manual' || !node.hostRoofSegmentId,
        },
        {
          key: 'connectionOffset',
          kind: 'number',
          unit: 'm',
          min: -1,
          max: 1,
          step: 0.01,
          visibleIf: (node) => node.connectionMode === 'auto' && Boolean(node.hostRoofSegmentId),
        },
        {
          key: 'matchHostRoofMaterial',
          kind: 'boolean',
          visibleIf: (node) => node.connectionMode === 'auto' && Boolean(node.hostRoofId),
        },
        {
          key: 'matchHostRoofStructure',
          kind: 'boolean',
          visibleIf: (node) => node.connectionMode === 'auto' && Boolean(node.hostRoofId),
        },
        {
          key: 'roofThickness',
          kind: 'number',
          unit: 'm',
          min: 0.02,
          max: 0.5,
          step: 0.01,
        },
        {
          key: 'shingleThickness',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.5,
          step: 0.005,
        },
        { key: 'pitch', kind: 'number', unit: '°', min: 1, max: 45, step: 1 },
        {
          key: 'eaveOverhang',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1.5,
          step: 0.05,
        },
        {
          key: 'sideOverhang',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1.5,
          step: 0.05,
        },
      ],
    },
    {
      label: 'Structure',
      fields: [
        { key: 'postCount', kind: 'number', min: 2, max: 20, step: 1 },
        {
          key: 'postInset',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 3,
          step: 0.05,
        },
        {
          key: 'postWidth',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.6,
          step: 0.01,
        },
        {
          key: 'postDepth',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.6,
          step: 0.01,
        },
        {
          key: 'beamHeight',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.8,
          step: 0.01,
        },
        {
          key: 'beamWidth',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.6,
          step: 0.01,
        },
      ],
    },
  ],
  invariants: [
    (node) => {
      const layout = resolveLeanToLayout(node)
      return layout.effectivePitchDegrees + 1e-6 < node.pitch
        ? [
            {
              field: 'pitch',
              msg: `Pitch is too steep for the selected height and projection; leave at least ${MIN_LEAN_TO_POST_HEIGHT}m of post height.`,
              severity: 'error' as const,
            },
          ]
        : []
    },
  ],
}
