import type {
  AnyNode,
  AnyNodeId,
  HandleDescriptor,
  NodeDefinition,
  SceneApi,
  WallNode,
} from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import {
  isManagedLeanToNode,
  isManagedLeanToPost,
  leanToDownspoutLayoutPatch,
  leanToGutterLayoutPatch,
  leanToPostLayoutPatch,
  leanToRoofSegmentLayoutPatch,
  managedLeanToPostIndex,
  managedLeanToPostSide,
  resolveLeanToPostBaseY,
  resolveLeanToPostGutterSetback,
} from './assembly'
import { buildLeanToExtensionFloorplan } from './floorplan'
import { leanToResizeAffordance } from './floorplan-affordances'
import { leanToFloorplanMoveTarget } from './floorplan-move'
import { buildLeanToExtensionGeometry, leanToExtensionGeometryKey } from './geometry'
import { resolveLeanToLayout } from './layout'
import { leanToPaint } from './paint'
import { deriveLeanToResizePatch, leanToExtensionParametrics } from './parametrics'
import { applyLeanToRoofAttachment, resolveLeanToRoofAttachment } from './roof-attachment'
import { LeanToExtensionNode } from './schema'
import { leanToSlots } from './slots'

const HEIGHT_HANDLE_OFFSET = 0.25
const SPAN_HANDLE_OFFSET = 0.3
const ROOF_EDGE_SNAP_TOLERANCE = 0.3

function resolveHostWall(node: LeanToExtensionNode, sceneApi: SceneApi): WallNode | null {
  if (!node.parentId) return null
  const wall = sceneApi.get<WallNode>(node.parentId as AnyNodeId)
  return wall?.type === 'wall' ? wall : null
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
    magneticSnap: (node, newValue, sceneApi) => {
      const wall = resolveHostWall(node, sceneApi)
      if (!wall) return newValue
      const attachment = resolveLeanToRoofAttachment(
        { ...node, highEdgeHeight: newValue },
        wall,
        sceneApi.nodes(),
      )
      return attachment &&
        Math.abs(attachment.highEdgeHeight - newValue) <= ROOF_EDGE_SNAP_TOLERANCE
        ? attachment.highEdgeHeight
        : newValue
    },
    apply: (node, newValue, sceneApi) => {
      const wall = resolveHostWall(node, sceneApi)
      const attachment = wall
        ? resolveLeanToRoofAttachment({ ...node, highEdgeHeight: newValue }, wall, sceneApi.nodes())
        : null
      if (
        attachment &&
        Math.abs(attachment.highEdgeHeight - newValue) <= ROOF_EDGE_SNAP_TOLERANCE
      ) {
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
    },
    placement: {
      position: (node) => [0, node.highEdgeHeight + HEIGHT_HANDLE_OFFSET, 0],
    },
    measureLabel: 'High edge height',
  }
}

function leanToManagedPreviewOverrides(
  node: LeanToExtensionNode,
  patch: Partial<LeanToExtensionNode>,
  sceneApi: SceneApi,
): ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> {
  const next = { ...node, ...patch } as LeanToExtensionNode
  const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
  const entries: Array<readonly [AnyNodeId, Partial<AnyNode>]> = []

  const wall = next.parentId ? nodes[next.parentId as AnyNodeId] : undefined
  for (const childId of next.children) {
    const child = nodes[childId as AnyNodeId]
    if (!child) continue

    if (child.type === 'column' && isManagedLeanToPost(child, next.id)) {
      const index = managedLeanToPostIndex(child)
      if (index === null) continue
      const side = managedLeanToPostSide(child)
      const baseY =
        wall?.type === 'wall' ? resolveLeanToPostBaseY(next, wall, nodes, index, side) : 0
      const gutterSetback = side === 'low' ? resolveLeanToPostGutterSetback(next, child) : 0
      entries.push([
        child.id as AnyNodeId,
        leanToPostLayoutPatch(next, index, baseY, gutterSetback, side) as Partial<AnyNode>,
      ])
      continue
    }

    if (child.type !== 'roof' || !isManagedLeanToNode(child, next.id, 'roof')) continue
    const segment = child.children
      .map((id) => nodes[id as AnyNodeId])
      .find(
        (candidate) =>
          candidate?.type === 'roof-segment' &&
          isManagedLeanToNode(candidate, next.id, 'roof-segment'),
      )
    if (segment?.type !== 'roof-segment') continue

    const segmentPatch = leanToRoofSegmentLayoutPatch(next, nodes)
    entries.push([segment.id as AnyNodeId, segmentPatch as Partial<AnyNode>])

    const nextSegment = { ...segment, ...segmentPatch }
    const gutter = segment.children
      .map((id) => nodes[id as AnyNodeId])
      .find(
        (candidate) =>
          candidate?.type === 'gutter' && isManagedLeanToNode(candidate, next.id, 'gutter'),
      )
    if (gutter?.type !== 'gutter') continue
    const gutterPatch = leanToGutterLayoutPatch(nextSegment, next, gutter, nodes)
    entries.push([gutter.id as AnyNodeId, gutterPatch as Partial<AnyNode>])

    const nextGutter = { ...gutter, ...gutterPatch }
    const downspout = segment.children
      .map((id) => nodes[id as AnyNodeId])
      .find(
        (candidate) =>
          candidate?.type === 'downspout' && isManagedLeanToNode(candidate, next.id, 'downspout'),
      )
    if (downspout?.type === 'downspout') {
      entries.push([
        downspout.id as AnyNodeId,
        leanToDownspoutLayoutPatch(nextSegment, nextGutter, next, downspout) as Partial<AnyNode>,
      ])
    }
  }

  return entries
}

function spanPatch(
  node: LeanToExtensionNode,
  span: number,
  side: 'left' | 'right',
): Partial<LeanToExtensionNode> {
  const localSign = side === 'right' ? 1 : -1
  const sign = Math.cos(node.rotation[1]) >= 0 ? localSign : -localSign
  return {
    span,
    autoSpan: false,
    position: [
      node.position[0] + (sign * (span - node.span)) / 2,
      node.position[1],
      node.position[2],
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
    max: 1000,
    currentValue: (node) => node.span,
    apply: (node, span) => spanPatch(node, span, side),
    previewOverrides: (node, span, sceneApi) =>
      leanToManagedPreviewOverrides(node, spanPatch(node, span, side), sceneApi),
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

const leanToExtensionHandles: HandleDescriptor<LeanToExtensionNode>[] = [highEdgeHeightHandle()]
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

export const leanToExtensionDefinition: NodeDefinition<typeof LeanToExtensionNode> = {
  kind: 'lean-to-extension',
  schemaVersion: 7,
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
  floorplanAffordances: { 'lean-to-resize': leanToResizeAffordance },
  affordanceTools: { move: () => import('./move-tool') },
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Attach lean-to extension to wall' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Lean-to Extension',
    description: 'An open mono-pitch roof attached to a wall and supported by a pillar row.',
    icon: { kind: 'url', src: '/icons/lean-to-extension.webp' },
    paletteSection: 'structure',
    paletteGroup: 'roof-features',
    paletteOrder: 105,
  },
  mcp: {
    description:
      'A wall-hosted open lean-to canopy composed from a standard shed roof segment, standard gutter and downspout accessories, editable column children, ledger, rafters, and a front beam.',
  },
}
