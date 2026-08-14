import { type AnyNodeId, nodeRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { toggleDoorOpenState } from './door-interaction'
import { isOperableWindowType, toggleWindowOpenState } from './window-interaction'

/**
 * The E-key selection action — operate the selected node (door / window /
 * registry-contributed kinds like cabinet doors).
 *
 * Returns `null` when E is free, which is what lets the orbit camera claim E
 * for its own descend movement: both listeners sit on `document` and the
 * camera's runs first, so the camera has to know whether this action would
 * have fired before it consumes the key.
 */
export function resolveSelectionOpenToggle(): (() => void) | null {
  const selectedIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
  if (selectedIds.length !== 1) return null

  const node = useScene.getState().nodes[selectedIds[0]!]
  if (!node) return null

  const registryE = nodeRegistry.get(node.type)?.keyboardActions?.e
  if (registryE?.appliesTo(node)) return () => registryE.run(node)

  if (node.type === 'door' && node.openingKind !== 'opening') {
    return () => toggleDoorOpenState(node.id)
  }

  if (
    node.type === 'window' &&
    node.openingKind !== 'opening' &&
    isOperableWindowType(node.windowType)
  ) {
    return () => toggleWindowOpenState(node.id)
  }

  return null
}
