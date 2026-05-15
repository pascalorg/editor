'use client'

import { type SlabNode, useScene } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { moveSlabDragAction } from './actions/move'

/**
 * Phase 5 Stage D — thin React wrapper around `moveSlabDragAction`.
 *
 * Replaces the legacy `MoveSlabTool` (182 LoC). All math + history
 * dance lives in the action; this wrapper just renders the cursor
 * sphere following the live polygon center.
 */
export const SlabMoveTool: React.FC<{ node: SlabNode }> = ({ node }) => {
  const slabId = node.id

  const initialCenter: [number, number] =
    node.polygon.length > 0
      ? [
          node.polygon.reduce((s, [x]) => s + x, 0) / node.polygon.length,
          node.polygon.reduce((s, [, z]) => s + z, 0) / node.polygon.length,
        ]
      : [0, 0]

  // Live polygon center — re-derived from the scene store every tick
  // since the action writes the translated polygon onto the slab.
  const liveCenter = useScene((s) => {
    const live = s.nodes[slabId]
    if (live?.type !== 'slab') return initialCenter
    const poly = (live as SlabNode).polygon
    if (poly.length === 0) return initialCenter
    let sx = 0
    let sz = 0
    for (const [x, z] of poly) {
      sx += x
      sz += z
    }
    return [sx / poly.length, sz / poly.length] as [number, number]
  })

  const exitMoveMode = (committed: boolean) => {
    if (committed) triggerSFX('sfx:item-place')
    useViewer.getState().setSelection({ selectedIds: [slabId] })
    useEditor.getState().setMovingNode(null)
  }

  useDragAction({
    active: true,
    action: moveSlabDragAction,
    initial: {
      node,
      point: initialCenter,
    },
    onCommit: () => exitMoveMode(true),
    onCancel: () => exitMoveMode(false),
  })

  return (
    <group>
      <CursorSphere position={[liveCenter[0], 0, liveCenter[1]]} showTooltip={false} />
    </group>
  )
}

export default SlabMoveTool
