'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { FLOWER_PRESETS, FLOWER_SEED_POOL } from './flower-presets'
import FlowerPreview from './flower-preview'
import { FlowerNode } from './flower-schema'
import { usePlacement } from './placement'
import { useTreesStore } from './store'

/** The flowers placement tool — mirrors the trees tool, reading the flower
 * brush from the shared store. Petal colour is baked from the preset at
 * placement, then editable per-flower in the inspector. */
export default function FlowerTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const preset = useTreesStore((s) => s.flowerPreset)
  const height = useTreesStore((s) => s.flowerHeight)

  const previewNode = useMemo(
    () =>
      FlowerNode.parse({
        preset,
        height,
        petalColor: FLOWER_PRESETS[preset].petalColor,
        seed: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [preset, height],
  )

  const { cursorRef, cursorVisible } = usePlacement(activeLevelId, (position) => {
    if (!activeLevelId) return
    const s = useTreesStore.getState()
    const flower = FlowerNode.parse({
      preset: s.flowerPreset,
      height: s.flowerHeight,
      petalColor: FLOWER_PRESETS[s.flowerPreset].petalColor,
      seed: FLOWER_SEED_POOL[Math.floor(Math.random() * FLOWER_SEED_POOL.length)] ?? 1,
      position,
      rotation: [0, (Math.floor(Math.random() * 8) * Math.PI) / 4, 0],
    })
    useScene.getState().createNode(flower as unknown as AnyNode, activeLevelId as AnyNodeId)
    useViewer.getState().setSelection({ selectedIds: [flower.id as AnyNodeId] })
    triggerSFX('sfx:item-place')
  })

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <FlowerPreview node={previewNode} />
    </group>
  )
}
