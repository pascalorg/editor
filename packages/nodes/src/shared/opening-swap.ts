import {
  type AnyNodeId,
  type DoorNode,
  type MechanismCapability,
  useInteractive,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'

/**
 * Commits a hinge or swing swap of a door or window as one undo step, then opens it through its
 * kind's mechanism when it is closed, so the new side is visible. The opening is the mechanism's
 * preview (the action menu's Open): it leaves the saved open state and the undo history alone.
 */
export function applyOpeningSwap<N extends DoorNode | WindowNode>(
  node: N,
  patch: Partial<N>,
  mechanism: MechanismCapability,
) {
  const scene = useScene.getState()
  scene.updateNode(node.id, patch)
  scene.dirtyNodes.add(node.id as AnyNodeId)
  if (node.parentId) scene.dirtyNodes.add(node.parentId as AnyNodeId)
  triggerSFX('sfx:item-rotate')
  const swapped = useScene.getState().nodes[node.id as AnyNodeId]
  if (swapped && !mechanism.isOn(swapped, useInteractive.getState())) mechanism.set(swapped, true)
}
