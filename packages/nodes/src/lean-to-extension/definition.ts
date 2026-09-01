import {
  type AnyNode,
  type AnyNodeId,
  findLevelAncestorId,
  type HandleDescriptor,
  type NodeDefinition,
  type RoofSegmentNode,
  type SceneApi,
  type WallNode,
} from '@pascal-app/core'
import {
  clearStructuralElevationGuide,
  type FloorplanNodeExtension,
  publishResolvedElevationGuide,
} from '@pascal-app/editor'
import { buildLeanToExtensionFloorplan } from './floorplan'
import { leanToResizeAffordance, leanToRotateAffordance } from './floorplan-affordances'
import { leanToFloorplanMoveTarget } from './floorplan-move'
import { buildLeanToExtensionGeometry, leanToExtensionGeometryKey } from './geometry'
import {
  leanToWallLocalPose,
  resolveLeanToEdgeSnapTargets,
  resolveLeanToHighEdgeHeightSnap,
  resolveLeanToLayout,
  resolveLeanToSpanResizeProposal,
} from './layout'
import { leanToManagedPreviewOverrides } from './managed-preview'
import { leanToPaint } from './paint'
import { deriveLeanToResizePatch, leanToExtensionParametrics } from './parametrics'
import { applyLeanToRoofAttachment, resolveLeanToRoofAttachment } from './roof-attachment'
import { LeanToExtensionNode } from './schema'
import { leanToSlots } from './slots'

const HEIGHT_HANDLE_OFFSET = 0.25
const SPAN_HANDLE_OFFSET = 0.3
const PITCH_HANDLE_OFFSET = 0.3
const ROOF_EDGE_SNAP_TOLERANCE = 0.3
const MIN_PITCH = 1
const MAX_PITCH = 45

function resolveConicalHost(node: LeanToExtensionNode, sceneApi: SceneApi): RoofSegmentNode | null {
  if (!(node.hostKind === 'conical-roof' && node.parentId)) return null
  const segment = sceneApi.get(node.parentId as AnyNodeId)
  return segment?.type === 'roof-segment' && segment.roofType === 'conical' ? segment : null
}

function resolveHostWall(node: LeanToExtensionNode, sceneApi: SceneApi): WallNode | null {
  if (!node.parentId) return null
  const wall = sceneApi.get<WallNode>(node.parentId as AnyNodeId)
  return wall?.type === 'wall' ? wall : null
}

function resolveAdjacentHeightSnap(
  node: LeanToExtensionNode,
  newValue: number,
  sceneApi: SceneApi,
) {
  const wall = resolveHostWall(node, sceneApi)
  if (!wall) return null
  return resolveLeanToHighEdgeHeightSnap(
    node,
    newValue,
    resolveLeanToEdgeSnapTargets(node, wall, sceneApi.nodes()),
  )
}

function resolveHighEdgeConnectionSnap(
  node: LeanToExtensionNode,
  newValue: number,
  sceneApi: SceneApi,
): number {
  const wall = resolveHostWall(node, sceneApi)
  if (!wall) return newValue
  const attachment = resolveLeanToRoofAttachment(
    { ...node, highEdgeHeight: newValue },
    wall,
    sceneApi.nodes(),
  )
  if (attachment && Math.abs(attachment.highEdgeHeight - newValue) <= ROOF_EDGE_SNAP_TOLERANCE) {
    return attachment.highEdgeHeight
  }
  return resolveAdjacentHeightSnap(node, newValue, sceneApi)?.highEdgeHeight ?? newValue
}

function publishAdjacentHeightGuide(node: LeanToExtensionNode, sceneApi: SceneApi): void {
  const wall = resolveHostWall(node, sceneApi)
  const nodes = sceneApi.nodes()
  const match = wall ? resolveAdjacentHeightSnap(node, node.highEdgeHeight, sceneApi) : null
  if (!(wall && match) || Math.abs(match.highEdgeHeight - node.highEdgeHeight) > 1e-4) {
    clearStructuralElevationGuide(node.id)
    return
  }

  const pose = leanToWallLocalPose(wall, node, 0)
  publishResolvedElevationGuide(
    {
      nodeId: node.id,
      levelId: findLevelAncestorId(node.id as AnyNodeId, nodes),
      anchor: [pose.position[0], pose.position[2]],
    },
    {
      id: `${match.target.nodeId ?? 'lean-to'}:high-edge`,
      elevation: match.target.roofEdgeY,
      anchor: match.target.anchor ?? [pose.position[0], pose.position[2]],
      label: 'Neighbor shed edge',
    },
  )
}

function highEdgeHeightPatch(
  node: LeanToExtensionNode,
  newValue: number,
  sceneApi: SceneApi,
): Partial<LeanToExtensionNode> {
  if (node.hostKind === 'slab-edge') {
    return {
      ...deriveLeanToResizePatch(node, { highEdgeHeight: newValue }),
      hostHeightOffset: node.hostHeightOffset + newValue - node.highEdgeHeight,
      connectionMode: 'manual',
    }
  }
  const conicalHost = resolveConicalHost(node, sceneApi)
  if (conicalHost) {
    return {
      ...deriveLeanToResizePatch(node, { highEdgeHeight: newValue }),
      hostHeightOffset: newValue - conicalHost.wallHeight,
      connectionMode: 'manual',
      hostRoofId: undefined,
      hostRoofSegmentId: undefined,
      hostRoofEdge: undefined,
      hostRoofEdgeRange: undefined,
      connectionInset: 0,
    }
  }
  const wall = resolveHostWall(node, sceneApi)
  const attachment = wall
    ? resolveLeanToRoofAttachment({ ...node, highEdgeHeight: newValue }, wall, sceneApi.nodes())
    : null
  if (attachment && Math.abs(attachment.highEdgeHeight - newValue) <= 1e-4) {
    const connected = applyLeanToRoofAttachment(node, attachment)
    return {
      highEdgeHeight: connected.highEdgeHeight,
      lowEdgeHeight: connected.lowEdgeHeight,
      connectionMode: connected.connectionMode,
      hostRoofId: connected.hostRoofId,
      hostRoofSegmentId: connected.hostRoofSegmentId,
      hostRoofEdge: connected.hostRoofEdge,
      hostRoofEdgeRange: connected.hostRoofEdgeRange,
      connectionInset: connected.connectionInset,
      span: connected.span,
      position: connected.position,
      roofThickness: connected.roofThickness,
      shingleThickness: connected.shingleThickness,
    }
  }
  return {
    ...deriveLeanToResizePatch(node, { highEdgeHeight: newValue }),
    connectionMode: 'manual',
    hostRoofId: undefined,
    hostRoofSegmentId: undefined,
    hostRoofEdge: undefined,
    hostRoofEdgeRange: undefined,
    connectionInset: 0,
  }
}

function highEdgeHeightHandle(): HandleDescriptor<LeanToExtensionNode> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    shape: 'tracker',
    min: 0.8,
    max: 1000,
    currentValue: (node) => node.highEdgeHeight,
    connectionSnap: resolveHighEdgeConnectionSnap,
    apply: highEdgeHeightPatch,
    previewOverrides: (node, newValue, sceneApi) =>
      leanToManagedPreviewOverrides(node, highEdgeHeightPatch(node, newValue, sceneApi), sceneApi),
    onDrag: publishAdjacentHeightGuide,
    onDragEnd: (node) => clearStructuralElevationGuide(node.id),
    placement: {
      position: (node) => [0, node.highEdgeHeight + HEIGHT_HANDLE_OFFSET, 0],
    },
    measureLabel: 'High edge height',
  }
}

function pitchPatch(
  node: LeanToExtensionNode,
  lowEdgeHeight: number,
): Partial<LeanToExtensionNode> {
  const pitch = Math.max(
    MIN_PITCH,
    Math.min(
      MAX_PITCH,
      (Math.atan2(node.highEdgeHeight - lowEdgeHeight, Math.max(0.001, node.projection)) * 180) /
        Math.PI,
    ),
  )
  return {
    pitch,
    lowEdgeHeight: node.highEdgeHeight - node.projection * Math.tan((pitch * Math.PI) / 180),
  }
}

function pitchHandle(): HandleDescriptor<LeanToExtensionNode> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: (node) => resolveLeanToLayout({ ...node, pitch: MAX_PITCH }).lowEdgeHeight,
    max: (node) => resolveLeanToLayout({ ...node, pitch: MIN_PITCH }).lowEdgeHeight,
    gridSnap: true,
    currentValue: (node) => resolveLeanToLayout(node).lowEdgeHeight,
    apply: (node, lowEdgeHeight) => pitchPatch(node, lowEdgeHeight),
    previewOverrides: (node, lowEdgeHeight, sceneApi) =>
      leanToManagedPreviewOverrides(node, pitchPatch(node, lowEdgeHeight), sceneApi),
    placement: {
      position: (node) => {
        const layout = resolveLeanToLayout(node)
        return [
          0,
          layout.lowEdgeHeight + HEIGHT_HANDLE_OFFSET,
          node.projection + Math.max(0, node.lowOverhang) + PITCH_HANDLE_OFFSET,
        ]
      },
    },
  }
}

function spanPatch(
  node: LeanToExtensionNode,
  span: number,
  side: 'left' | 'right',
  sceneApi?: SceneApi,
): Partial<LeanToExtensionNode> {
  const wall = sceneApi ? resolveHostWall(node, sceneApi) : null
  if (wall && sceneApi) {
    const proposal = resolveLeanToSpanResizeProposal({
      node,
      wall,
      rawSpan: span,
      side,
      edgeSnapTargets: resolveLeanToEdgeSnapTargets(node, wall, sceneApi.nodes()),
      tolerance: 1e-4,
    })
    return {
      span: proposal.span,
      autoSpan: false,
      position: proposal.position,
      ...(proposal.target
        ? {
            highEdgeHeight: proposal.highEdgeHeight,
            lowEdgeHeight: proposal.lowEdgeHeight,
            pitch: proposal.pitch,
          }
        : {}),
    }
  }
  const localSign = side === 'right' ? 1 : -1
  const centerShift = (localSign * (span - node.span)) / 2
  const cos = Math.cos(node.rotation[1])
  const sin = Math.sin(node.rotation[1])
  const deltaX = centerShift * cos
  const deltaZ = -centerShift * sin
  return {
    span,
    autoSpan: false,
    position: [
      Math.abs(deltaX) < 1e-12 ? node.position[0] : node.position[0] + deltaX,
      node.position[1],
      Math.abs(deltaZ) < 1e-12 ? node.position[2] : node.position[2] + deltaZ,
    ],
  }
}

function spanHandle(side: 'left' | 'right'): HandleDescriptor<LeanToExtensionNode> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: 0.5,
    max: (node, sceneApi) => {
      const wall = resolveHostWall(node, sceneApi)
      return wall
        ? resolveLeanToSpanResizeProposal({
            node,
            wall,
            rawSpan: 100,
            side,
            tolerance: 0,
          }).span
        : 100
    },
    currentValue: (node) => node.span,
    connectionSnap: (node, span, sceneApi) => {
      const wall = resolveHostWall(node, sceneApi)
      if (!wall) return span
      return resolveLeanToSpanResizeProposal({
        node,
        wall,
        rawSpan: span,
        side,
        edgeSnapTargets: resolveLeanToEdgeSnapTargets(node, wall, sceneApi.nodes()),
      }).span
    },
    apply: (node, span, sceneApi) => spanPatch(node, span, side, sceneApi),
    previewOverrides: (node, span, sceneApi) =>
      leanToManagedPreviewOverrides(node, spanPatch(node, span, side, sceneApi), sceneApi),
    visible: (node) => node.hostKind !== 'conical-roof',
    placement: {
      position: (node) => {
        const layout = resolveLeanToLayout(node)
        return [
          sign * (node.span / 2 + SPAN_HANDLE_OFFSET),
          layout.lowEdgeHeight + HEIGHT_HANDLE_OFFSET,
          node.projection,
        ]
      },
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
    measureLabel: 'Span',
  }
}

function circularRadiusPatch(
  node: LeanToExtensionNode,
  radius: number,
): Partial<LeanToExtensionNode> {
  return {
    span: 2 * Math.PI * radius,
    autoSpan: true,
    position: [0, node.position[1], radius],
    spanArcCenterZ: -radius,
    spanArcRadius: radius,
  }
}

function circularRadiusHandle(side: 'left' | 'right'): HandleDescriptor<LeanToExtensionNode> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: 0.25,
    max: 12.5,
    gridSnap: true,
    currentValue: (node) => node.spanArcRadius ?? node.span / (2 * Math.PI),
    apply: (node, radius) => circularRadiusPatch(node, radius),
    previewOverrides: (node, radius, sceneApi) => {
      const patch = circularRadiusPatch(node, radius)
      const host = resolveConicalHost(node, sceneApi)
      const entries: Array<readonly [AnyNodeId, Partial<AnyNode>]> = host
        ? [[host.id as AnyNodeId, { width: radius * 2, depth: radius * 2 }]]
        : []
      entries.push(...leanToManagedPreviewOverrides(node, patch, sceneApi))
      return entries
    },
    commit: (node, patch, sceneApi) => {
      const host = resolveConicalHost(node, sceneApi)
      const radius = patch.spanArcRadius
      if (!(host && typeof radius === 'number')) return
      sceneApi.update(host.id as AnyNodeId, {
        width: radius * 2,
        depth: radius * 2,
      })
    },
    visible: (node, sceneApi) => resolveConicalHost(node, sceneApi) !== null,
    placement: {
      position: (node) => {
        const layout = resolveLeanToLayout(node)
        const radius = node.spanArcRadius ?? node.span / (2 * Math.PI)
        return [
          sign * (radius + layout.projection + node.lowOverhang + SPAN_HANDLE_OFFSET),
          layout.lowEdgeHeight + HEIGHT_HANDLE_OFFSET,
          -radius,
        ]
      },
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
    measureLabel: 'Host radius',
  }
}

function freestandingRotationHandle(): HandleDescriptor<LeanToExtensionNode> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (node, delta) => ({
      rotation: [node.rotation[0], node.rotation[1] - delta, node.rotation[2]],
    }),
    visible: (node) => node.hostKind === 'freestanding',
    placement: {
      position: (node) => [
        node.span / 2 + SPAN_HANDLE_OFFSET,
        resolveLeanToLayout(node).lowEdgeHeight + HEIGHT_HANDLE_OFFSET,
        node.projection / 2,
      ],
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (node) => Math.hypot(node.span / 2, node.projection / 2) + 0.12,
      y: (node) => resolveLeanToLayout(node).lowEdgeHeight + HEIGHT_HANDLE_OFFSET,
    },
  }
}

const leanToExtensionHandles: HandleDescriptor<LeanToExtensionNode>[] = [
  highEdgeHeightHandle(),
  pitchHandle(),
  freestandingRotationHandle(),
]
leanToExtensionHandles.push({
  kind: 'linear-resize',
  axis: 'z',
  anchor: 'min',
  min: 0.5,
  max: 1000,
  currentValue: (node) => node.projection,
  apply: (node, projection) => ({
    projection,
    ...deriveLeanToResizePatch(node, { projection }),
  }),
  placement: {
    position: (node) => {
      const layout = resolveLeanToLayout(node)
      return [0, layout.lowEdgeHeight + HEIGHT_HANDLE_OFFSET, node.projection]
    },
  },
  measureLabel: 'Projection',
})
leanToExtensionHandles.push(spanHandle('right'), spanHandle('left'))
leanToExtensionHandles.push(circularRadiusHandle('right'), circularRadiusHandle('left'))

export const leanToExtensionDefinition: NodeDefinition<typeof LeanToExtensionNode> = {
  kind: 'lean-to-extension',
  schemaVersion: 13,
  schema: LeanToExtensionNode,
  category: 'structure',
  snapProfile: 'structural',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<LeanToExtensionNode>,
  },
  defaults: () => {
    const parsed = LeanToExtensionNode.parse({})
    const { id: _id, type: _type, ...defaults } = parsed
    return defaults
  },
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    slots: () => leanToSlots(),
    paint: leanToPaint,
  },
  relations: {
    cascadeDelete: 'descendants',
    hosts: ['column', 'roof'],
  },
  parametrics: leanToExtensionParametrics,
  handles: leanToExtensionHandles,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  geometry: buildLeanToExtensionGeometry,
  geometryKey: leanToExtensionGeometryKey,
  system: {
    module: () => import('./system'),
    priority: 1,
  },
  floorplan: buildLeanToExtensionFloorplan,
  floorplanMoveTarget: leanToFloorplanMoveTarget,
  floorplanAffordances: {
    'lean-to-resize': leanToResizeAffordance,
    'lean-to-rotate': leanToRotateAffordance,
  },
  affordanceTools: { move: () => import('./move-tool') },
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    {
      key: 'Left click',
      label: 'Place canopy or set the next run point',
      labelKey: 'nodes.leanToExtension.toolHints.place',
    },
    { key: 'R / T', label: 'Rotate or flip the run side', labelKey: 'nodes.leanToExtension.toolHints.rotateFlip' },
    { key: 'F', label: 'Cycle mono / gable / butterfly', labelKey: 'nodes.leanToExtension.toolHints.cycleStyle' },
    { key: 'Esc', label: 'End run / cancel', labelKey: 'common.cancel' },
  ],
  presentation: {
    label: 'Canopy',
    description:
      'An attached mono-pitch or freestanding mono, gable, or butterfly canopy with managed structure and drainage.',
    icon: { kind: 'url', src: '/icons/lean-to-extension.webp' },
    paletteSection: 'structure',
    paletteGroup: 'roof-features',
    paletteOrder: 105,
  },
  mcp: {
    description:
      'An open canopy that can attach to a wall or upper slab edge, stand freestanding with a mono, gable, or butterfly roof, or wrap around a conical roof base. It composes standard roof segments, gutters, downspouts, editable column children, framing, and beams.',
  },
}
