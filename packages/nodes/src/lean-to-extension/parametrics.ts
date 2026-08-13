import type { LeanToExtensionNode, ParametricDescriptor } from '@pascal-app/core'
import { MIN_LEAN_TO_POST_HEIGHT, resolveLeanToLayout } from './layout'

export const leanToExtensionParametrics: ParametricDescriptor<LeanToExtensionNode> = {
  groups: [
    {
      label: 'Roof',
      fields: [
        { key: 'span', kind: 'number', unit: 'm', min: 0.5, max: 20, step: 0.1 },
        { key: 'projection', kind: 'number', unit: 'm', min: 0.5, max: 10, step: 0.1 },
        { key: 'highEdgeHeight', kind: 'number', unit: 'm', min: 0.8, max: 10, step: 0.05 },
        { key: 'pitch', kind: 'number', unit: '°', min: 1, max: 45, step: 1 },
        { key: 'eaveOverhang', kind: 'number', unit: 'm', min: 0, max: 1.5, step: 0.05 },
        { key: 'sideOverhang', kind: 'number', unit: 'm', min: 0, max: 1.5, step: 0.05 },
      ],
    },
    {
      label: 'Structure',
      fields: [
        { key: 'postCount', kind: 'number', min: 2, max: 20, step: 1 },
        { key: 'postInset', kind: 'number', unit: 'm', min: 0, max: 3, step: 0.05 },
        { key: 'postWidth', kind: 'number', unit: 'm', min: 0.05, max: 0.6, step: 0.01 },
        { key: 'postDepth', kind: 'number', unit: 'm', min: 0.05, max: 0.6, step: 0.01 },
        { key: 'beamHeight', kind: 'number', unit: 'm', min: 0.05, max: 0.8, step: 0.01 },
        { key: 'beamWidth', kind: 'number', unit: 'm', min: 0.05, max: 0.6, step: 0.01 },
      ],
    },
    {
      label: 'Wall connection',
      fields: [
        { key: 'flashingEnabled', kind: 'boolean' },
        {
          key: 'flashingHeight',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 0.5,
          step: 0.01,
          visibleIf: (node) => node.flashingEnabled,
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
