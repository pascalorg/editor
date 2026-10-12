import {
  type AnyNode,
  type AnyNodeId,
  type NodeDefinition,
  WallFeatureNode,
} from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { restingFloorplanAffectedIds } from '../shared/resting-surface-plan'
import { wallFeatureHandles } from './editing'
import { buildWallFeatureFloorplan, wallFeatureFloorplanDependencies } from './floorplan'
import { wallFeaturePlanAffordance, wallFeaturePlanMove } from './floorplan-interaction'
import { WallFeatureInspector } from './inspector'
import { wallFeaturePaint } from './paint'
import {
  wallFeatureLocalFrame,
  wallFeatureSupportHeight,
  wallFeatureSurfaceProvider,
} from './surfaces'

let projected:
  | {
      nodes: Record<AnyNodeId, AnyNode>
      overrides: Map<string, Record<string, unknown>>
      result: Record<AnyNodeId, AnyNode>
    }
  | undefined

export const wallFeatureDefinition: NodeDefinition<typeof WallFeatureNode> = {
  kind: 'wall-feature',
  schemaVersion: 1,
  schema: WallFeatureNode,
  category: 'structure',
  defaults: () => {
    const { id: _id, type: _type, ...rest } = WallFeatureNode.parse({ face: 'a' })
    return rest
  },
  localFrame: wallFeatureLocalFrame,
  capabilities: {
    paint: wallFeaturePaint,
    slots: () => [{ slotId: 'surface', label: 'Feature finish' }],
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    surfaces: {
      hosting: wallFeatureSurfaceProvider,
      top: {
        height: (n) => (n.type === 'wall-feature' && n.mode === 'bump' ? n.height : 0),
        supportHeight: wallFeatureSupportHeight,
      },
    },
  },
  handles: wallFeatureHandles,
  floorplan: buildWallFeatureFloorplan,
  floorplanDependencies: wallFeatureFloorplanDependencies,
  floorplanMoveTarget: wallFeaturePlanMove,
  floorplanAffordances: { 'edit-feature': wallFeaturePlanAffordance },
  floorplanSiblingOverrides: ({ nodes, liveOverrides }) => {
    if (!liveOverrides.size) return nodes
    if (projected?.nodes === nodes && projected.overrides === liveOverrides) return projected.result
    const result = { ...nodes }
    for (const [id, patch] of liveOverrides) {
      const node = nodes[id as AnyNodeId]
      if (node) result[id as AnyNodeId] = { ...node, ...patch } as AnyNode
    }
    projected = { nodes, overrides: liveOverrides, result }
    return result
  },
  floorplanAffectedIds: restingFloorplanAffectedIds,
  tool: () => import('./tool'),
  affordanceTools: { move: () => import('./move-tool') },
  snapProfile: 'structural',
  snapDraftDirectional: false,
  toolHints: [
    { key: 'Left click', label: 'Place feature' },
    { key: 'Esc', label: 'Cancel' },
    { key: 'Alt', label: 'Use raw cursor' },
  ],
  affordanceHints: {
    move: [
      { key: 'Left click', label: 'Place feature' },
      { key: 'Esc', label: 'Cancel' },
      { key: 'Alt', label: 'Use raw cursor' },
    ],
  },
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      directDrag: true,
      actionMenu: { actions: () => import('./actions') },
    } satisfies FloorplanNodeExtension<WallFeatureNode>,
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  parametrics: {
    groups: [
      {
        label: 'Wall feature',
        fields: [{ key: 'mode', kind: 'custom', component: WallFeatureInspector }],
      },
    ],
  },
  relations: {
    hosts: ['wall-feature', 'item', 'procedural-item'],
    cascadeDelete: 'descendants',
  },
  // The root wall consumes geometry dirtiness; features have no separate solid.
  dirtyTracking: false,
  system: { module: () => import('./system'), priority: 3 },
  presentation: {
    label: 'Wall feature',
    description: 'A niche recessed into a wall face or a bump projecting from it.',
    icon: { kind: 'iconify', name: 'lucide:wallpaper' },
    hidden: true,
  },
}
