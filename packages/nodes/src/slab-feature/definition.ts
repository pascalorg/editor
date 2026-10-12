import {
  type AnyNode,
  type AnyNodeId,
  type NodeDefinition,
  planSlabFeaturePlacement,
  SlabFeatureNode,
} from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { restingFloorplanAffectedIds } from '../shared/resting-surface-plan'
import { slabFeatureHandles } from './editing'
import { buildSlabFeatureFloorplan, slabFeatureFloorplanDependencies } from './floorplan'
import { slabFeaturePlanAffordance, slabFeaturePlanMove } from './floorplan-interaction'
import { SlabFeatureInspector } from './inspector'
import { slabFeaturePaint } from './paint'
import {
  slabFeatureLocalFrame,
  slabFeatureSupportHeight,
  slabFeatureSurfaceProvider,
} from './surfaces'

let projected:
  | {
      nodes: Readonly<Record<AnyNodeId, AnyNode>>
      overrides: Map<string, Record<string, unknown>>
      result: Record<AnyNodeId, AnyNode>
    }
  | undefined
export const slabFeatureDefinition: NodeDefinition<typeof SlabFeatureNode> = {
  kind: 'slab-feature',
  schemaVersion: 1,
  schema: SlabFeatureNode.meta({
    validateRelations: (node: SlabFeatureNode, nodes: Readonly<Record<string, AnyNode>>) =>
      planSlabFeaturePlacement(nodes, node),
  }),
  category: 'structure',
  defaults: () => {
    const { id: _id, type: _type, ...rest } = SlabFeatureNode.parse({})
    return rest
  },
  localFrame: slabFeatureLocalFrame,
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    paint: slabFeaturePaint,
    slots: () => [{ slotId: 'surface', label: 'Feature finish' }],
    surfaces: {
      hosting: slabFeatureSurfaceProvider,
      top: {
        height: (n) => (n.type === 'slab-feature' ? (n.mode === 'bump' ? n.depth : -n.depth) : 0),
        supportHeight: slabFeatureSupportHeight,
      },
    },
  },
  handles: slabFeatureHandles,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  parametrics: {
    groups: [
      {
        label: 'Slab feature',
        fields: [{ key: 'mode', kind: 'custom', component: SlabFeatureInspector }],
      },
    ],
  },
  relations: { hosts: ['slab-feature', 'item', 'procedural-item'], cascadeDelete: 'descendants' },
  dirtyTracking: false,
  floorplan: buildSlabFeatureFloorplan,
  floorplanDependencies: slabFeatureFloorplanDependencies,
  floorplanDependsOnSiblings: true,
  floorplanMoveTarget: slabFeaturePlanMove,
  floorplanAffordances: { 'edit-feature': slabFeaturePlanAffordance },
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
    } satisfies FloorplanNodeExtension<SlabFeatureNode>,
  },
  presentation: {
    label: 'Slab feature',
    description: 'A niche in the slab top or a bump projecting upward.',
    icon: { kind: 'iconify', name: 'lucide:box' },
    hidden: true,
  },
}
