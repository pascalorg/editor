'use client'

import { type AnyNodeId, type SeparatorNode, sceneRegistry, useScene } from '@pascal-app/core'
import {
  type SelectionAffordanceProps,
  SeparatorEndGrip,
  separatorFloorElevation,
  separatorPushHandles,
  useEditor,
  useInteractionScope,
  WallPushArrow,
} from '@pascal-app/editor'
import { createPortal } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import type { Object3D } from 'three'

/**
 * A selected invisible wall's 3D handles, the twins of its plan ones: a push
 * arrow off each side (the wall push: the invisible walls joined to it follow
 * and those T'd into it stretch) and a grip at each end (drag it across the
 * floor; the ones joined there follow). They lie on the floor of the room it
 * closes, where its dashed line is drawn, and hide while a drag runs.
 */
export default function SeparatorSelectionAffordance({ node, readOnly }: SelectionAffordanceProps) {
  const editing = useEditor((s) => s.mode === 'select' && !s.isFloorplanHovered)
  const idle = useInteractionScope((s) => s.scope.kind === 'idle')
  const floor = useScene((s) => separatorFloorElevation(s.nodes, node.id))
  const levelId = node.parentId
  const [level, setLevel] = useState<Object3D | null>(null)
  useEffect(() => {
    let frame = 0
    const resolve = () => {
      const next = levelId ? (sceneRegistry.nodes.get(levelId as AnyNodeId) ?? null) : null
      setLevel((current) => (current === next ? current : next))
      if (!next && levelId) frame = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frame)
  }, [levelId])
  if (node.type !== 'separator' || readOnly || !editing || !idle || !level || !levelId) return null
  const separator = node as SeparatorNode
  return createPortal(
    <>
      {separatorPushHandles(separator, floor).map((handle) => (
        <WallPushArrow handle={handle} key={handle.key} levelId={levelId} />
      ))}
      {(['start', 'end'] as const).map((endpoint) => (
        <SeparatorEndGrip
          endpoint={endpoint}
          height={floor + 0.02}
          key={endpoint}
          levelId={levelId}
          separator={separator}
        />
      ))}
    </>,
    level,
  )
}
