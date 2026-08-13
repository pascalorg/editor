import type {
  AnyNodeId,
  HandleDescriptor,
  NodeDefinition,
  SceneApi,
  WallNode,
} from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildLeanToExtensionFloorplan } from './floorplan'
import { buildLeanToExtensionGeometry, leanToExtensionGeometryKey } from './geometry'
import { leanToExtensionParametrics } from './parametrics'
import { LeanToExtensionNode } from './schema'
import { applyLeanToRoofAttachment, resolveLeanToRoofAttachment } from './roof-attachment'

const HEIGHT_HANDLE_OFFSET = 0.25
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
    max: 10,
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
          connectionMode: connected.connectionMode,
          hostRoofId: connected.hostRoofId,
          hostRoofSegmentId: connected.hostRoofSegmentId,
          hostRoofEdge: connected.hostRoofEdge,
          connectionInset: connected.connectionInset,
          span: connected.span,
          position: connected.position,
          roofThickness: connected.roofThickness,
          shingleThickness: connected.shingleThickness,
        }
      }
      return {
        highEdgeHeight: newValue,
        connectionMode: 'manual',
        hostRoofId: undefined,
        hostRoofSegmentId: undefined,
        hostRoofEdge: undefined,
        connectionInset: 0,
      }
    },
    placement: {
      position: (node) => [0, node.highEdgeHeight + HEIGHT_HANDLE_OFFSET, 0],
    },
    measureLabel: 'High edge height',
  }
}

const leanToExtensionHandles: HandleDescriptor<LeanToExtensionNode>[] = [highEdgeHeightHandle()]

export const leanToExtensionDefinition: NodeDefinition<typeof LeanToExtensionNode> = {
  kind: 'lean-to-extension',
  schemaVersion: 1,
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
  },
  relations: {
    cascadeDelete: 'descendants',
    hosts: ['column', 'roof'],
  },
  parametrics: leanToExtensionParametrics,
  handles: leanToExtensionHandles,
  geometry: buildLeanToExtensionGeometry,
  geometryKey: leanToExtensionGeometryKey,
  system: {
    module: () => import('./system'),
    priority: 1,
  },
  floorplan: buildLeanToExtensionFloorplan,
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
    paletteOrder: 105,
  },
  mcp: {
    description:
      'A wall-hosted open lean-to canopy composed from a standard shed roof segment, standard gutter and downspout accessories, editable column children, ledger, rafters, and a front beam.',
  },
}
