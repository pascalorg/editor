'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import useEditor from '../../store/use-editor'
import { FloorplanGeometryRenderer } from './renderers/floorplan-geometry-renderer'

/**
 * Cursor-driven placement for registered kinds in the floor plan.
 *
 * Activates when `useEditor.movingNode` is set to a node whose kind is
 * registered with `def.floorplan`. Tracks the pointer on the floor plan
 * SVG via the `[data-floorplan-scene]` `<g>` (set by floorplan-panel.tsx
 * via a one-line attribute) and renders a translucent ghost at the
 * cursor position. Click commits via `updateNode`; Esc cancels.
 *
 * Coordinate conversion routes through the scene `<g>`'s `getScreenCTM`,
 * matching the legacy `getSvgPointFromClientPoint` so cursor → meters
 * accounts for the floor plan's pan / zoom / building rotation.
 *
 * Lives outside the floorplan-panel.tsx monolith. Mounts once globally
 * at the panel root; renders nothing unless the active movingNode is a
 * registered kind.
 *
 * Wired to wall / item / etc. as those kinds migrate — same shape for
 * every kind that supplies `def.floorplan`.
 */
export function FloorplanRegistryMoveOverlay() {
  const movingNode = useEditor((s) => s.movingNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const def = movingNode ? nodeRegistry.get(movingNode.type) : null
  const builder = def?.floorplan
  const isActive = !!movingNode && !!builder

  useEffect(() => {
    if (!isActive) {
      setCursor(null)
      return
    }

    const scene = document.querySelector('[data-floorplan-scene]') as SVGGElement | null
    if (!scene) return

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
      if (m) setCursor(m)
    }

    const onClick = (event: MouseEvent) => {
      const m = toMeters(event.clientX, event.clientY)
      if (!(m && movingNode)) return
      // Only commit when click happens inside the floor plan SVG.
      const path = event.composedPath()
      if (!path.some((el) => el === scene)) return
      event.stopPropagation()

      const node = useScene.getState().nodes[movingNode.id as AnyNodeId]
      // Treat the existing position's Y as preserved (floor plan only
      // moves on the X-Z plane). For new (`isNew` metadata) nodes from
      // duplicate, this is still the cloned source's height — correct.
      const oldPos = ((node ?? movingNode) as unknown as { position?: [number, number, number] })
        .position ?? [0, 0, 0]
      useScene.getState().updateNode(
        movingNode.id as AnyNodeId,
        {
          position: [m.x, oldPos[1], m.y],
        } as Partial<AnyNode>,
      )
      // Clear isNew so duplicated nodes don't try to re-place themselves.
      const meta = (movingNode as unknown as { metadata?: Record<string, unknown> }).metadata
      if (meta?.isNew) {
        useScene.getState().updateNode(
          movingNode.id as AnyNodeId,
          {
            metadata: { ...meta, isNew: false },
          } as Partial<AnyNode>,
        )
      }
      setMovingNode(null)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMovingNode(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('click', onClick, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('click', onClick, { capture: true } as EventListenerOptions)
      window.removeEventListener('keydown', onKey)
    }
  }, [isActive, movingNode, setMovingNode])

  if (!(isActive && cursor && movingNode && builder)) return null

  // Build the ghost at the cursor position. Clone the node and swap
  // position to the cursor; pass to the kind's builder. Same path the
  // FloorplanRegistryLayer uses for the static render — visual identity
  // matches automatically.
  const nodes = useScene.getState().nodes
  const ghostNode = {
    ...(movingNode as unknown as { position: [number, number, number] }),
    position: [cursor.x, 0, cursor.y],
  } as unknown as AnyNode
  const ctx: GeometryContext = {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
    parent: null,
  }
  const geometry = (builder as (n: AnyNode, c: GeometryContext) => FloorplanGeometry | null)(
    ghostNode,
    ctx,
  )
  if (!geometry) return null

  const scene = document.querySelector('[data-floorplan-scene]') as SVGGElement | null
  if (!scene) return null

  return createPortal(
    <g pointerEvents="none">
      <g opacity={0.5}>
        <FloorplanGeometryRenderer geometry={geometry} />
      </g>
    </g>,
    scene as unknown as Element,
  )
}
