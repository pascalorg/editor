'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { usePlacement } from './placement'
import { TREE_SEED_POOL } from './presets'
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
        treeType: brush.treeType,
        height: brush.height,
        foliageDensity: brush.foliageDensity,
        trunkThickness: brush.trunkThickness,
        leafless: brush.leafless,
        seed: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [
      brush.preset,
      brush.size,
      brush.treeType,
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
      treeType: s.treeType,
      height: s.height,
      foliageDensity: s.foliageDensity,
      trunkThickness: s.trunkThickness,
      leafless: s.leafless,
      // Bounded pool so placed trees share instancing variants; random Y
      // rotation keeps a planted row from looking cloned.
      seed: TREE_SEED_POOL[Math.floor(Math.random() * TREE_SEED_POOL.length)] ?? 1,
      position,
      rotation: [0, Math.random() * Math.PI * 2, 0],
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
