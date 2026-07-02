'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { usePlacement } from './placement'
import TreePreview from './preview'
import { TreeNode } from './schema'
import { useTreesStore } from './store'

/**
 * The trees placement tool. Mounted by the host's registry-first `ToolManager`
 * whenever `tool === 'trees:tree'` — no host edit per kind. Reads the panel
 * brush from the plugin store, ghosts a preview at the snapped cursor, and
 * commits a tree on click. Snapping + level conversion live in `usePlacement`.
 */
export default function TreeTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const brush = useTreesStore()

  const previewNode = useMemo(
    () =>
      TreeNode.parse({
        preset: brush.preset,
        size: brush.size,
        height: brush.height,
        foliageDensity: brush.foliageDensity,
        trunkThickness: brush.trunkThickness,
        leafless: brush.leafless,
        // seed/treeType left unset → the ghost shows the pure preset, as placed.
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [
      brush.preset,
      brush.size,
      brush.height,
      brush.foliageDensity,
      brush.trunkThickness,
      brush.leafless,
    ],
  )

  const { cursorRef, cursorVisible } = usePlacement(activeLevelId, (position) => {
    if (!activeLevelId) return
    const s = useTreesStore.getState()
    const tree = TreeNode.parse({
      preset: s.preset,
      size: s.size,
      height: s.height,
      foliageDensity: s.foliageDensity,
      trunkThickness: s.trunkThickness,
      leafless: s.leafless,
      // seed/treeType unset → the pure ez-tree preset (its canonical seed + type).
      // All same-preset trees then share one instancing variant; a random Y
      // rotation keeps a planted row from looking cloned. Use Randomize (inspector)
      // to vary a tree's seed.
      position,
      rotation: [0, (Math.floor(Math.random() * 8) * Math.PI) / 4, 0],
    })
    useScene.getState().createNode(tree as unknown as AnyNode, activeLevelId as AnyNodeId)
    useViewer.getState().setSelection({ selectedIds: [tree.id as AnyNodeId] })
    triggerSFX('sfx:item-place')
  })

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <TreePreview node={previewNode} />
    </group>
  )
}
