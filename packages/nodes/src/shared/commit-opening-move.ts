import { type AnyNodeId, type DoorNode, type WindowNode, useScene } from '@pascal-app/core'

/** A move changes placement, not persistent ownership (Array, assets, etc.). */
export function commitOpeningMove(id: AnyNodeId, patch: Partial<DoorNode | WindowNode>) {
  const node = useScene.getState().nodes[id]
  if (!node || (node.type !== 'window' && node.type !== 'door')) return
  const { isNew: _new, isTransient: _transient, ...metadata } = node.metadata
  useScene.getState().updateNode(id, { ...patch, metadata })
}
