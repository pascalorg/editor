'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { usePlacement } from './placement'
import LumberPreview from './preview'
import { LumberNode } from './schema'
import { useBonesStore } from './store'

/**
 * The lumber placement tool. Mounted by the host's registry-first
 * `ToolManager` whenever `tool === 'bones:lumber'` — no host edit per kind.
 * Reads the panel brush from the plugin store, ghosts a preview at the
 * snapped cursor, and commits a member on click.
 */
export default function LumberTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const size = useBonesStore((s) => s.size)
  const length = useBonesStore((s) => s.length)
  const orientation = useBonesStore((s) => s.orientation)

  const previewNode = useMemo(
    () =>
      LumberNode.parse({
        size,
        length,
        orientation,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [size, length, orientation],
  )

  const { cursorRef, cursorVisible } = usePlacement(
    activeLevelId,
    (position) => {
      if (!activeLevelId) return
      const s = useBonesStore.getState()
      const member = LumberNode.parse({
        size: s.size,
        length: s.length,
        orientation: s.orientation,
        position,
        rotation: [0, 0, 0],
      })
      useScene.getState().createNode(member as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [member.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
    },
    previewNode,
  )

  if (!activeLevelId) return null

  return (
    <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
      <LumberPreview node={previewNode} />
    </group>
  )
}
