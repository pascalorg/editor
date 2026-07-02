'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { GRASS_PRESETS, GRASS_SEED_POOL } from './grass-presets'
import GrassPreview from './grass-preview'
import { GrassNode } from './grass-schema'
import { usePlacement } from './placement'
import { useTreesStore } from './store'

/** The grass placement tool — mirrors the trees/flowers tools, reading the grass
 * brush from the shared store. Blade colour is baked from the preset at
 * placement, then editable per-tuft in the inspector. */
export default function GrassTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const preset = useTreesStore((s) => s.grassPreset)
  const height = useTreesStore((s) => s.grassHeight)

  const previewNode = useMemo(
    () =>
      GrassNode.parse({
        preset,
        height,
        bladeColor: GRASS_PRESETS[preset].bladeColor,
        seed: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [preset, height],
  )

  const { cursorRef, cursorVisible } = usePlacement(activeLevelId, (position) => {
    if (!activeLevelId) return
    const s = useTreesStore.getState()
    const grass = GrassNode.parse({
      preset: s.grassPreset,
      height: s.grassHeight,
      bladeColor: GRASS_PRESETS[s.grassPreset].bladeColor,
      seed: GRASS_SEED_POOL[Math.floor(Math.random() * GRASS_SEED_POOL.length)] ?? 1,
      position,
      rotation: [0, (Math.floor(Math.random() * 8) * Math.PI) / 4, 0],
    })
    useScene.getState().createNode(grass as unknown as AnyNode, activeLevelId as AnyNodeId)
    useViewer.getState().setSelection({ selectedIds: [grass.id as AnyNodeId] })
    triggerSFX('sfx:item-place')
  })

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <GrassPreview node={previewNode} />
    </group>
  )
}
