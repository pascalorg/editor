import {
  type AnyNodeId,
  type FenceFeatureNode,
  FenceGateNode,
  FenceOpeningNode,
  type FloorplanMoveTarget,
  findLevelAncestorId,
  type NodeDefinition,
  type ParametricDescriptor,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { buildFenceFeatureFloorplan } from './floorplan'
import { fenceFeatureAffordance } from './floorplan-affordances'
import { buildFenceFeatureGeometry } from './geometry'
import { fenceFeatureHandles } from './handles'
import { FenceFeatureEditor } from './inspector'
import { toggleFenceGate } from './interaction'
import { createFenceFeatureMoveSession } from './move-session'

const floorplanMoveTarget: FloorplanMoveTarget<FenceFeatureNode> = ({ node, sceneApi }) => {
  if (!sceneApi) throw new Error('Fence feature move requires SceneApi')
  const levelId =
    (findLevelAncestorId(node.id as AnyNodeId, sceneApi.nodes()) as AnyNodeId | undefined) ?? null
  const session = createFenceFeatureMoveSession(node, sceneApi, levelId, (id) =>
    useViewer.getState().setSelection({ selectedIds: [id] }),
  )
  return {
    affectedIds: session.affectedIds,
    apply: ({ planPoint }) => session.update(planPoint),
    canCommit: session.canCommit,
    commit: session.commit,
  }
}

const parametrics: ParametricDescriptor<FenceFeatureNode> = {
  groups: [
    {
      label: 'Settings',
      fields: [{ key: 'center', kind: 'custom', component: FenceFeatureEditor }],
    },
  ],
}
const shared = {
  schemaVersion: 1,
  category: 'structure' as const,
  capabilities: { selectable: { hitVolume: 'bbox' as const }, deletable: true },
  geometry: buildFenceFeatureGeometry,
  floorplan: buildFenceFeatureFloorplan,
  floorplanDependencies: (node: FenceFeatureNode) =>
    node.parentId ? [node.parentId as AnyNodeId] : [],
  floorplanAffordances: { 'move-feature': fenceFeatureAffordance },
  handles: fenceFeatureHandles,
  floorplanMoveTarget,
  affordanceTools: { move: () => import('./move-tool') },
  affordanceHints: {
    move: [
      { key: 'Left click', label: 'Place on a fence' },
      { key: 'Esc', label: 'Cancel move' },
    ],
  },
  parametrics,
}
export const fenceGateDefinition: NodeDefinition<typeof FenceGateNode | typeof FenceOpeningNode> = {
  ...shared,
  kind: 'fence-gate',
  keyboardActions: {
    e: {
      appliesTo: (node) => node.type === 'fence-gate',
      run: (node) => toggleFenceGate(node.id as AnyNodeId),
    },
  },
  schema: FenceGateNode,
  defaults: () => {
    const { id, type, ...rest } = FenceGateNode.parse({})
    return rest
  },
  presentation: {
    label: 'Gate',
    description: 'A gate hosted by a fence.',
    icon: { kind: 'url', src: '/icons/fence.webp' },
    paletteSection: 'structure',
    hidden: true,
  },
}
export const fenceOpeningDefinition: NodeDefinition<
  typeof FenceGateNode | typeof FenceOpeningNode
> = {
  ...shared,
  kind: 'fence-opening',
  schema: FenceOpeningNode,
  defaults: () => {
    const { id, type, ...rest } = FenceOpeningNode.parse({})
    return rest
  },
  presentation: {
    label: 'Open Passage',
    description: 'An intentional opening in a fence.',
    icon: { kind: 'url', src: '/icons/door.webp' },
    paletteSection: 'structure',
    hidden: true,
  },
}
