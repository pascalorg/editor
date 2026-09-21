import { type AnyNode, type AnyNodeId, createSceneApi, useScene } from '@pascal-app/core'
import { planHostedEdit } from '../shared/hosted-resize'

export const columnHostedPolicy = {
  host: (node: AnyNode) => node.type === 'column',
  child: (_node: AnyNode) => true,
}

export function planColumnEdit(id: AnyNodeId, patch: Partial<AnyNode>) {
  return planHostedEdit(
    createSceneApi(useScene),
    (scene) => scene.update(id, patch),
    columnHostedPolicy,
  )
}
