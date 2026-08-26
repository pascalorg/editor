import type { LeanToExtensionNode, ParametricDescriptor } from '@pascal-app/core'
import { leanToLowEdgeHeight, MIN_LEAN_TO_POST_HEIGHT, resolveLeanToLayout } from './layout'

const degrees = (rise: number, run: number) =>
  Math.max(1, Math.min(45, (Math.atan2(rise, Math.max(0.001, run)) * 180) / Math.PI))

const COVERING_MIN_PITCH: Record<LeanToExtensionNode['coveringType'], number | null> = {
  generic: null,
  shingle: 9.5,
  'metal-panel': 2,
}

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
  let lowEdgeHeight = leanToLowEdgeHeight(previous)

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
      ...(patch.canopyForm === 'gable' || patch.canopyForm === 'butterfly'
        ? { highSideMode: 'independent-high-beam' as const, autoSpan: false }
        : {}),
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
      ...(previous.hostKind === 'slab-edge' && typeof patch.highEdgeHeight === 'number'
        ? {
            hostHeightOffset:
              previous.hostHeightOffset + patch.highEdgeHeight - previous.highEdgeHeight,
          }
        : {}),
      ...deriveLeanToResizePatch(previous, patch),
    }
  },
  groups: [
    {
      label: 'Size',
      fields: [
        {
          key: 'canopyForm',
          label: 'Roof form',
          kind: 'enum',
          options: ['mono', 'gable', 'butterfly'],
          display: 'segmented',
          visibleIf: (node) => node.hostKind === 'freestanding',
        },
        {
          key: 'autoSpan',
          label: 'Match host width',
          kind: 'boolean',
          visibleIf: (node) => node.hostKind !== 'freestanding',
        },
        {
          key: 'span',
          label: 'Width',
          kind: 'number',
          unit: 'm',
          min: 0.5,
          max: 100,
          step: 0.1,
        },
        {
          key: 'projection',
          label: 'Projection',
          kind: 'number',
          unit: 'm',
          min: 0.5,
          max: 10,
          step: 0.1,
        },
        {
          key: 'highEdgeHeight',
          label: 'High edge height',
          kind: 'number',
          unit: 'm',
          min: 0.8,
          max: 10,
          step: 0.05,
          visibleIf: (node) => node.connectionMode === 'manual' || !node.hostRoofSegmentId,
        },
        {
          key: 'pitch',
          label: 'Slope',
          kind: 'number',
          unit: '°',
          min: 1,
          max: 45,
          step: 1,
        },
      ],
    },
    {
      label: 'Connection',
      fields: [
        {
          key: 'connectionMode',
          label: 'Roof connection',
          kind: 'enum',
          options: ['auto', 'manual'],
          display: 'segmented',
          visibleIf: (node) => node.hostKind === 'wall',
        },
        {
          key: 'highSideMode',
          label: 'High-side support',
          kind: 'enum',
          options: ['wall-ledger', 'independent-high-beam'],
          visibleIf: (node) => node.hostKind === 'wall',
        },
        {
          key: 'connectionOffset',
          label: 'Connection offset',
          kind: 'number',
          unit: 'm',
          min: -1,
          max: 1,
          step: 0.01,
          visibleIf: (node) => node.connectionMode === 'auto' && Boolean(node.hostRoofSegmentId),
        },
        {
          key: 'matchHostRoofMaterial',
          label: 'Match host roof material',
          kind: 'boolean',
          visibleIf: (node) => node.connectionMode === 'auto' && Boolean(node.hostRoofId),
        },
        {
          key: 'matchHostRoofStructure',
          label: 'Match host roof structure',
          kind: 'boolean',
          visibleIf: (node) => node.connectionMode === 'auto' && Boolean(node.hostRoofId),
        },
      ],
    },
    {
      label: 'Structure',
      fields: [
        {
          key: 'postLayoutMode',
          label: 'Post layout',
          kind: 'enum',
          options: ['count', 'target-spacing'],
        },
        {
          key: 'postCount',
          label: 'Post count',
          kind: 'number',
          min: 2,
          max: 20,
          step: 1,
          visibleIf: (node) => node.postLayoutMode === 'count',
        },
        {
          key: 'postSpacing',
          label: 'Post spacing',
          kind: 'number',
          unit: 'm',
          min: 0.3,
          max: 10,
          step: 0.1,
          visibleIf: (node) => node.postLayoutMode === 'target-spacing',
        },
        {
          key: 'postWidth',
          label: 'Post width',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.6,
          step: 0.01,
        },
        {
          key: 'postDepth',
          label: 'Post depth',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.6,
          step: 0.01,
        },
        {
          key: 'beamHeight',
          label: 'Beam height',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.8,
          step: 0.01,
        },
        {
          key: 'beamWidth',
          label: 'Beam width',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.6,
          step: 0.01,
        },
        {
          key: 'framingStrategy',
          label: 'Framing',
          kind: 'enum',
          options: ['hidden', 'rafters', 'purlins', 'covering-specific'],
        },
        {
          key: 'autoMiterCorners',
          label: 'Auto miter corners',
          kind: 'boolean',
        },
      ],
    },
    {
      label: 'Drainage',
      fields: [
        { key: 'gutterEnabled', label: 'Gutters', kind: 'boolean' },
        {
          key: 'gutterProfile',
          label: 'Gutter profile',
          kind: 'enum',
          options: ['k-style', 'half-round', 'box'],
          visibleIf: (node) => node.gutterEnabled,
        },
        {
          key: 'gutterSize',
          label: 'Gutter size',
          kind: 'number',
          unit: 'm',
          min: 0.04,
          max: 0.3,
          step: 0.01,
          visibleIf: (node) => node.gutterEnabled,
        },
        {
          key: 'downspoutEnabled',
          label: 'Downspout',
          kind: 'boolean',
          visibleIf: (node) => node.gutterEnabled,
        },
        {
          key: 'downspoutPosition',
          label: 'Downspout position',
          kind: 'number',
          min: -1,
          max: 1,
          step: 0.05,
          visibleIf: (node) => node.gutterEnabled && node.downspoutEnabled,
        },
      ],
    },
    {
      label: 'Advanced',
      fields: [
        {
          key: 'resizeLock',
          label: 'When resizing',
          kind: 'enum',
          options: ['preserve-high-edge', 'preserve-low-edge', 'preserve-pitch'],
        },
        {
          key: 'lowEdgeHeight',
          label: 'Outer edge height',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 10,
          step: 0.05,
          visibleIf: (node) => node.connectionMode === 'manual' || !node.hostRoofSegmentId,
        },
        {
          key: 'roofThickness',
          label: 'Roof thickness',
          kind: 'number',
          unit: 'm',
          min: 0.02,
          max: 0.5,
          step: 0.01,
        },
        {
          key: 'shingleThickness',
          label: 'Shingle thickness',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.5,
          step: 0.005,
        },
        {
          key: 'coveringType',
          label: 'Roof covering',
          kind: 'enum',
          options: ['generic', 'shingle', 'metal-panel'],
        },
        {
          key: 'highOverhang',
          label: 'High-side overhang',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1.5,
          step: 0.05,
        },
        {
          key: 'lowOverhang',
          label: 'Outer overhang',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1.5,
          step: 0.05,
        },
        {
          key: 'leftOverhang',
          label: 'Left overhang',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1.5,
          step: 0.05,
        },
        {
          key: 'rightOverhang',
          label: 'Right overhang',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1.5,
          step: 0.05,
        },
        { key: 'sideFlashing', label: 'Side flashing', kind: 'boolean' },
        {
          key: 'flashingProjection',
          label: 'Flashing projection',
          kind: 'number',
          unit: 'm',
          min: 0.01,
          max: 0.5,
          step: 0.005,
          visibleIf: (node) => node.sideFlashing,
        },
        {
          key: 'flashingHeight',
          label: 'Flashing height',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 0.5,
          step: 0.01,
          visibleIf: (node) => node.sideFlashing,
        },
        {
          key: 'leftEndCondition',
          label: 'Left end',
          kind: 'enum',
          options: ['open', 'wall-abutment', 'joined'],
        },
        {
          key: 'rightEndCondition',
          label: 'Right end',
          kind: 'enum',
          options: ['open', 'wall-abutment', 'joined'],
        },
        {
          key: 'ledgerVerticalOffset',
          label: 'High beam offset',
          kind: 'number',
          unit: 'm',
          min: -1,
          max: 1,
          step: 0.01,
          visibleIf: (node) => node.highSideMode === 'independent-high-beam',
        },
        {
          key: 'ledgerDepth',
          label: 'High beam depth',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 0.5,
          step: 0.01,
          visibleIf: (node) => node.highSideMode === 'independent-high-beam',
        },
        {
          key: 'ledgerHeight',
          label: 'High beam height',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.8,
          step: 0.01,
          visibleIf: (node) => node.highSideMode === 'independent-high-beam',
        },
        {
          key: 'lowBeamInset',
          label: 'Beam setback',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 2,
          step: 0.05,
        },
        {
          key: 'postInset',
          label: 'Post inset',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 3,
          step: 0.05,
        },
        {
          key: 'rafterWidth',
          label: 'Rafter width',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 0.4,
          step: 0.01,
          visibleIf: (node) => node.framingStrategy === 'rafters',
        },
        {
          key: 'rafterHeight',
          label: 'Rafter height',
          kind: 'number',
          unit: 'm',
          min: 0.03,
          max: 0.5,
          step: 0.01,
        },
        {
          key: 'rafterSpacing',
          label: 'Rafter spacing',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 3,
          step: 0.05,
          visibleIf: (node) => node.framingStrategy === 'rafters',
        },
        {
          key: 'rafterEndInset',
          label: 'Rafter end inset',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 3,
          step: 0.05,
          visibleIf: (node) => node.framingStrategy === 'rafters',
        },
        {
          key: 'purlinWidth',
          label: 'Purlin width',
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
          label: 'Purlin height',
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
          label: 'Purlin spacing',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 3,
          step: 0.05,
          visibleIf: (node) =>
            node.framingStrategy === 'purlins' || node.framingStrategy === 'covering-specific',
        },
        {
          key: 'postBracing',
          label: 'Post bracing',
          kind: 'enum',
          options: ['none', 'knee'],
        },
        {
          key: 'footingStyle',
          label: 'Footings',
          kind: 'enum',
          options: ['none', 'base-plate', 'concrete-pad'],
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
    (node) => {
      const minimum = COVERING_MIN_PITCH[node.coveringType]
      return minimum !== null && node.pitch + 1e-6 < minimum
        ? [
            {
              field: 'pitch',
              msg: `${node.coveringType} covering typically needs at least ${minimum}° pitch; verify the selected product and local requirements.`,
              severity: 'warning' as const,
            },
          ]
        : []
    },
  ],
}
