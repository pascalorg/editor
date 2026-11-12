import {
  type AnyNodeId,
  type FenceFeatureNode,
  type FenceGateNode,
  type FenceOpeningNode,
  type FloorplanMoveTarget,
  findLevelAncestorId,
  type ParametricDescriptor,
} from '@pascal-app/core'

import type { FloorplanNodeExtension } from '@pascal-app/editor'

import { useViewer } from '@pascal-app/viewer'
import type { NodeEditContribution } from '../definition-contributions'
import { fenceFeatureAffordance } from './floorplan-affordances'
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

export const fenceGateEditContribution: NodeEditContribution<
  typeof FenceGateNode | typeof FenceOpeningNode
> = {
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
  keyboardActions: {
    e: {
      appliesTo: (node) => node.type === 'fence-gate',
      run: (node) => toggleFenceGate(node.id as AnyNodeId),
    },
  },
  extensions: {
    'pascal:editor/floorplan': {
      actionMenu: { actions: () => import('./actions') },
    } satisfies FloorplanNodeExtension<FenceFeatureNode>,
  },
}

export const fenceOpeningEditContribution: NodeEditContribution<
  typeof FenceGateNode | typeof FenceOpeningNode
> = {
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
