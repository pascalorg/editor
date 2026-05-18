'use client'

import { type SlabNode, useScene } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { moveSlabDragAction } from './actions/move'

/**
 * Phase 5 Stage D — thin React wrapper around `moveSlabDragAction`.
 *
 * Replaces the legacy `MoveSlabTool` (182 LoC). All math + history
 * dance lives in the action; this wrapper renders the cursor sphere
 * at the live polygon center.
 *
 * NOTE on selector stability: the live polygon center MUST be derived
 * via `useMemo` over the node reference rather than computed inside
 * the `useScene` selector — returning a fresh `[x, z]` tuple from the
 * selector on every call triggers "getSnapshot result not cached"
 * → infinite re-render. Same pattern in fence/ceiling move-tool.
 */
export const SlabMoveTool: React.FC<{ node: SlabNode }> = ({ node }) => {
  const slabId = node.id
  const initialCenter: [number, number] = useMemo(() => {
    if (node.polygon.length === 0) return [0, 0]
    let sx = 0
    let sz = 0
    for (const [x, z] of node.polygon) {
      sx += x
      sz += z
    }
    return [sx / node.polygon.length, sz / node.polygon.length]
  }, [node.polygon])

  // Subscribe to the live node reference (stable across renders when
  // the node hasn't changed; new reference per scene update). Derive
  // the center inside `useMemo` so the selector itself stays cached.
  const liveNode = useScene((s) => s.nodes[slabId])
  const liveCenter = useMemo<[number, number]>(() => {
    if (liveNode?.type !== 'slab') return initialCenter
    const poly = (liveNode as SlabNode).polygon
    if (poly.length === 0) return initialCenter
    let sx = 0
    let sz = 0
    for (const [x, z] of poly) {
      sx += x
      sz += z
    }
    return [sx / poly.length, sz / poly.length]
  }, [liveNode, initialCenter])

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
