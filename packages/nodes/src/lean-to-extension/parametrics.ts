import type { LeanToExtensionNode, ParametricDescriptor } from '@pascal-app/core'
import { MIN_LEAN_TO_POST_HEIGHT, resolveLeanToLayout } from './layout'

const degrees = (rise: number, run: number) =>
  Math.max(1, Math.min(45, (Math.atan2(rise, Math.max(0.001, run)) * 180) / Math.PI))

const lowEdgeOf = (node: Pick<LeanToExtensionNode, 'highEdgeHeight' | 'projection' | 'pitch'>) =>
  node.highEdgeHeight - node.projection * Math.tan((node.pitch * Math.PI) / 180)

export function deriveLeanToResizePatch(
  previous: LeanToExtensionNode,
  patch: Partial<LeanToExtensionNode>,
): Partial<LeanToExtensionNode> {
  const changesProjection = Object.hasOwn(patch, 'projection')
  const changesHigh = Object.hasOwn(patch, 'highEdgeHeight')
  const changesLow = Object.hasOwn(patch, 'lowEdgeHeight')
  const changesPitch = Object.hasOwn(patch, 'pitch')
  if (!(changesProjection || changesHigh || changesLow || changesPitch)) return {}

  const projection = patch.projection ?? previous.projection
  let highEdgeHeight = patch.highEdgeHeight ?? previous.highEdgeHeight
  let pitch = patch.pitch ?? previous.pitch
  let lowEdgeHeight = lowEdgeOf(previous)

  if (changesLow) {
    lowEdgeHeight = patch.lowEdgeHeight ?? lowEdgeHeight
    if (previous.resizeLock === 'preserve-pitch') {
      highEdgeHeight = lowEdgeHeight + projection * Math.tan((pitch * Math.PI) / 180)
    } else {
      pitch = degrees(highEdgeHeight - lowEdgeHeight, projection)
      lowEdgeHeight = highEdgeHeight - projection * Math.tan((pitch * Math.PI) / 180)
    }
  } else if (changesProjection && !changesHigh && !changesPitch) {
    if (previous.resizeLock === 'preserve-high-edge') {
      pitch = degrees(highEdgeHeight - lowEdgeHeight, projection)
    } else if (previous.resizeLock === 'preserve-low-edge') {
      highEdgeHeight = lowEdgeHeight + projection * Math.tan((pitch * Math.PI) / 180)
    } else {
      lowEdgeHeight = highEdgeHeight - projection * Math.tan((pitch * Math.PI) / 180)
    }
  } else if (changesPitch && !changesHigh) {
    if (previous.resizeLock === 'preserve-low-edge') {
      highEdgeHeight = lowEdgeHeight + projection * Math.tan((pitch * Math.PI) / 180)
    } else {
      lowEdgeHeight = highEdgeHeight - projection * Math.tan((pitch * Math.PI) / 180)
    }
  } else if (changesHigh && !changesPitch) {
    if (previous.resizeLock === 'preserve-low-edge') {
      pitch = degrees(highEdgeHeight - lowEdgeHeight, projection)
    }
    lowEdgeHeight = highEdgeHeight - projection * Math.tan((pitch * Math.PI) / 180)
  } else {
    lowEdgeHeight = highEdgeHeight - projection * Math.tan((pitch * Math.PI) / 180)
  }

  return { highEdgeHeight, lowEdgeHeight, pitch }
}

export const leanToExtensionParametrics: ParametricDescriptor<LeanToExtensionNode> = {
  derive: (next, patch, previous = next) => {
    return {
      ...(patch.connectionMode === 'manual'
        ? {
            hostRoofId: undefined,
            hostRoofSegmentId: undefined,
            hostRoofEdge: undefined,
            hostRoofEdgeRange: undefined,
            connectionInset: 0,
          }
        : {}),
      ...('roofThickness' in patch || 'shingleThickness' in patch
        ? { matchHostRoofStructure: false }
        : {}),
      ...('span' in patch ? { autoSpan: false } : {}),
      ...deriveLeanToResizePatch(previous, patch),
    }
  },
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
          key: 'resizeLock',
          kind: 'enum',
          options: ['preserve-high-edge', 'preserve-low-edge', 'preserve-pitch'],
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
          key: 'lowEdgeHeight',
          kind: 'number',
          unit: 'm',
          min: 0.2,
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
        { key: 'highSideFlashing', kind: 'boolean' },
        { key: 'sideFlashing', kind: 'boolean' },
        {
          key: 'flashingProjection',
          kind: 'number',
          unit: 'm',
          min: 0.01,
          max: 0.5,
          step: 0.005,
          visibleIf: (node) => node.highSideFlashing || node.sideFlashing,
        },
        {
          key: 'flashingHeight',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 0.5,
          step: 0.01,
          visibleIf: (node) => node.highSideFlashing || node.sideFlashing,
        },
        {
          key: 'flashingMaterial',
          kind: 'material',
          visibleIf: (node) => node.highSideFlashing || node.sideFlashing,
        },
        {
          key: 'leftEndCondition',
          kind: 'enum',
          options: ['open', 'wall-abutment', 'joined'],
        },
        {
          key: 'rightEndCondition',
          kind: 'enum',
          options: ['open', 'wall-abutment', 'joined'],
        },
      ],
    },
    {
      label: 'Structure',
      fields: [
        {
          key: 'framingStrategy',
          kind: 'enum',
          options: ['hidden', 'rafters', 'purlins', 'covering-specific'],
        },
        {
          key: 'purlinWidth',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 0.4,
          step: 0.01,
          visibleIf: (node) =>
            node.framingStrategy === 'purlins' || node.framingStrategy === 'covering-specific',
        },
        {
          key: 'purlinHeight',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 0.5,
          step: 0.01,
          visibleIf: (node) =>
            node.framingStrategy === 'purlins' || node.framingStrategy === 'covering-specific',
        },
        {
          key: 'purlinSpacing',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 3,
          step: 0.05,
          visibleIf: (node) =>
            node.framingStrategy === 'purlins' || node.framingStrategy === 'covering-specific',
        },
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
    {
      label: 'Drainage',
      fields: [
        { key: 'gutterEnabled', kind: 'boolean' },
        {
          key: 'gutterProfile',
          kind: 'enum',
          options: ['k-style', 'half-round', 'box'],
          visibleIf: (node) => node.gutterEnabled,
        },
        {
          key: 'gutterSize',
          kind: 'number',
          unit: 'm',
          min: 0.04,
          max: 0.3,
          step: 0.01,
          visibleIf: (node) => node.gutterEnabled,
        },
        {
          key: 'downspoutEnabled',
          kind: 'boolean',
          visibleIf: (node) => node.gutterEnabled,
        },
        {
          key: 'downspoutPosition',
          kind: 'number',
          min: -1,
          max: 1,
          step: 0.05,
          visibleIf: (node) => node.gutterEnabled && node.downspoutEnabled,
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
