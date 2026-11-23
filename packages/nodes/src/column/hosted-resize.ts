import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  createSceneApi,
  useScene,
} from '@pascal-app/core'
import { planHostedEdit } from '../shared/hosted-resize'
import { columnEditPatch } from './edit-policy'

export const columnHostedPolicy = {
  localSurfaces: true,
  host: (node: AnyNode) => node.type === 'column',
  child: (_node: AnyNode) => true,
}

export function planColumnEdit(id: AnyNodeId, patch: Partial<ColumnNode>) {
  const node = useScene.getState().nodes[id]
  if (node?.type !== 'column') return null
  patch = columnEditPatch(node, patch)
  return planHostedEdit(
    createSceneApi(useScene),
    (scene) => scene.update(id, patch),
    columnHostedPolicy,
  )
}
