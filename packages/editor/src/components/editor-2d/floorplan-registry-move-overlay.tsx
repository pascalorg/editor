'use client'

import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import { useEffect } from 'react'
import useEditor from '../../store/use-editor'

const GRID_STEP = 0.5

/**
 * Cursor-driven placement for registered kinds in the floor plan.
 *
 * Activates when `useEditor.movingNode` is set to a node whose kind is
 * registered with `def.floorplan`. Tracks the pointer on the floor plan
 * SVG via the `[data-floorplan-scene]` `<g>` (set by floorplan-panel.tsx
 * via a one-line attribute) and **imperatively translates the original
 * rendered entry** so the user sees the actual shape follow the cursor —
 * no ghost overlay, no double rendering.
 *
 * Coordinate conversion routes through the scene `<g>`'s `getScreenCTM`
 * so cursor → meters accounts for the floor plan's pan / zoom / building
 * rotation. Position snaps to a 0.5m grid (matches the 3D placement
 * tool's GRID_STEP). Pointerup commits via `updateNode`; Esc cancels.
 *
 * Lives outside the floorplan-panel.tsx monolith. Mounts once globally
 * at the panel root; renders nothing unless the active movingNode is a
 * registered kind.
 */
export function FloorplanRegistryMoveOverlay() {
  const movingNode = useEditor((s) => s.movingNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const def = movingNode ? nodeRegistry.get(movingNode.type) : null
  const isActive = !!movingNode && !!def?.floorplan

  useEffect(() => {
    if (!isActive || !movingNode) return

    const scene = document.querySelector('[data-floorplan-scene]') as SVGGElement | null
    if (!scene) return

    const entry = scene.querySelector(`[data-node-id="${movingNode.id}"]`) as SVGGElement | null
    if (!entry) return

    // Capture the original position so the imperative translate is a
    // pure delta — the inner FloorplanGeometry transform (the shelf
    // builder's `translate(px pz) rotate(deg)`) stays untouched.
    const originalPosition = ((
      movingNode as unknown as {
        position?: [number, number, number]
      }
    ).position ?? [0, 0, 0]) as [number, number, number]

    let lastSnapped: [number, number] | null = null

    const toMeters = (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = scene.ownerSVGElement
      if (!svg) return null
      const ctm = scene.getScreenCTM()
      if (!ctm) return null
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const m = pt.matrixTransform(ctm.inverse())
      return { x: m.x, y: m.y }
    }

    const onMove = (event: PointerEvent) => {
      const m = toMeters(event.clientX, event.clientY)
      if (!m) return
      const [sx, sz] = snapPointToGrid([m.x, m.y], GRID_STEP)
      const dx = sx - originalPosition[0]
      const dz = sz - originalPosition[2]
      entry.setAttribute('transform', `translate(${dx} ${dz})`)
      lastSnapped = [sx, sz]
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      // Commit only when the pointerup happened inside the floor plan
      // SVG (so clicks on the inspector / palette / tabs don't accidentally
      // commit a placement).
      const target = event.target as Element | null
      if (!target || !target.closest('[data-floorplan-scene]')) return

      const snapped = lastSnapped
      if (snapped) {
        const [sx, sz] = snapped
        const [, oldY] = originalPosition
        useScene
          .getState()
          .updateNode(movingNode.id as AnyNodeId, { position: [sx, oldY, sz] } as Partial<AnyNode>)
        const meta = (movingNode as unknown as { metadata?: Record<string, unknown> }).metadata
        if (meta?.isNew) {
          useScene.getState().updateNode(
            movingNode.id as AnyNodeId,
            {
              metadata: { ...meta, isNew: false },
            } as Partial<AnyNode>,
          )
        }
      }
      entry.removeAttribute('transform')
      setMovingNode(null)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        entry.removeAttribute('transform')
        setMovingNode(null)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKey)
      // Defensive cleanup in case the component unmounts mid-drag.
      entry.removeAttribute('transform')
    }
  }, [isActive, movingNode, setMovingNode])

  return null
}
