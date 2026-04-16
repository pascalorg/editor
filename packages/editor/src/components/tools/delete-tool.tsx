import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'

const DELETABLE_TYPES = new Set<AnyNode['type']>([
  'wall',
  'slab',
  'ceiling',
  'window',
  'door',
  'item',
  'zone',
  'roof',
  'roof-segment',
  'column',
  'stair',
])

function isDeletable(node: AnyNode): boolean {
  return DELETABLE_TYPES.has(node.type)
}

/**
 * DeleteTool — activated when the editor is in "delete" mode.
 * Clicking on a deletable node removes it from the scene.
 */
export const DeleteTool: React.FC = () => {
  useEffect(() => {
    const { levelId, zoneId } = useViewer.getState().selection

    const handleClick = (event: { node: AnyNode; stopPropagation: () => void }) => {
      const node = event.node
      if (!isDeletable(node)) return

      // Only delete nodes on the currently selected level/zone
      const nodes = useScene.getState().nodes
      let onLevel = false
      if (node.parentId === levelId) {
        onLevel = true
      }
      // Wall-attached children (window, door, item)
      if (
        (node.type === 'window' || node.type === 'door' || node.type === 'item') &&
        node.parentId
      ) {
        const parent = nodes[node.parentId as AnyNodeId]
        if (parent?.type === 'wall' && parent.parentId === levelId) {
          onLevel = true
        }
      }
      if (!onLevel) return

      // Zone check: if a zone is selected, only delete nodes in that zone
      if (zoneId) {
        const isZoneChild = node.parentId === zoneId || node.id === zoneId
        if (!isZoneChild) return
      }

      // Determine sfx type
      if (node.type === 'item' || node.type === 'window' || node.type === 'door') {
        sfxEmitter.emit('sfx:item-delete')
      } else {
        sfxEmitter.emit('sfx:structure-delete')
      }

      useScene.getState().deleteNode(node.id)
      event.stopPropagation()
    }

    const handlers: Array<{ event: string; handler: typeof handleClick }> = [
      { event: 'wall:click', handler: handleClick },
      { event: 'slab:click', handler: handleClick },
      { event: 'ceiling:click', handler: handleClick },
      { event: 'window:click', handler: handleClick },
      { event: 'door:click', handler: handleClick },
      { event: 'item:click', handler: handleClick },
      { event: 'zone:click', handler: handleClick },
      { event: 'roof:click', handler: handleClick },
      { event: 'roof-segment:click', handler: handleClick },
    ]

    for (const { event, handler } of handlers) {
      emitter.on(event, handler as any)
    }

    return () => {
      for (const { event, handler } of handlers) {
        emitter.off(event, handler as any)
      }
    }
  }, [])

  // No 3D visual needed — the cursor/hover feedback comes from the viewer
  return null
}
