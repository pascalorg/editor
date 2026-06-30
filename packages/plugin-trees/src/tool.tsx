'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Group, Vector3 } from 'three'
import { TREE_PRESETS } from './presets'
import TreePreview from './preview'
import { TreeNode, type TreePreset } from './schema'
import { useTreesStore } from './store'

const worldVec = new Vector3()

/** Default height for a preset, guarded against the noUncheckedIndexedAccess
 * `| undefined` on the record lookup. */
function presetHeight(preset: TreePreset): number {
  return (TREE_PRESETS[preset] ?? TREE_PRESETS.oak).defaultHeight
}

/**
 * Convert a world-space grid hit into the active level's local frame, the way
 * the host stores node positions. Re-derived here from the public
 * `sceneRegistry` because the built-in `floor-placement` helpers aren't part of
 * the public `@pascal-app/*` surface yet — a candidate for the future
 * `@pascal-app/plugin-api` package.
 */
function toLevelLocal(levelId: string, world: [number, number, number]): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) return [world[0], 0, world[2]]
  worldVec.set(world[0], world[1], world[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVec)
  return [worldVec.x, 0, worldVec.z]
}

/**
 * The trees placement tool. Mounted by the host's registry-first `ToolManager`
 * whenever `tool === 'trees:tree'` — no host edit per kind. Reads the chosen
 * preset from the plugin's own store, ghosts a preview at the cursor on
 * `grid:move`, and commits a tree on `grid:click`. This is the third leg of the
 * plugin surface: 3D rendering + placement from `def.geometry`/`def.tool`.
 */
export default function TreeTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const preset = useTreesStore((s) => s.preset)
  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)

  // Preview tree shaped by the currently-selected preset.
  const previewNode = useMemo(
    () =>
      TreeNode.parse({
        preset,
        height: presetHeight(preset),
        seed: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [preset],
  )

  useEffect(() => {
    if (!activeLevelId) return
    setCursorVisible(false)
    let lastWorld: [number, number, number] | null = null

    const onGridMove = (event: GridEvent) => {
      setCursorVisible(true)
      // The tool mounts inside the host's building-local group, so positioning
      // the ghost with the building-local hit keeps it under the cursor.
      const [lx, , lz] = event.localPosition
      cursorRef.current?.position.set(lx, 0, lz)
      lastWorld = event.position
    }

    const onGridClick = (event: GridEvent) => {
      const world = lastWorld ?? event.position
      const position = toLevelLocal(activeLevelId, world)
      const tree = TreeNode.parse({
        preset,
        height: presetHeight(preset),
        seed: Math.floor(Math.random() * 10000),
        position,
        rotation: [0, 0, 0],
      })
      useScene.getState().createNode(tree as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [tree.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
      // Stay active for rapid planting; Esc / a tool switch unmounts us.
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
    }
  }, [activeLevelId, preset])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <TreePreview node={previewNode} />
    </group>
  )
}
