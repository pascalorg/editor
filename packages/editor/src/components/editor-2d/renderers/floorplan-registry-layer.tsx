'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { FloorplanGeometryRenderer } from './floorplan-geometry-renderer'

/**
 * Registry-driven floor-plan layer.
 *
 * For every node in the active level whose definition exposes
 * `def.floorplan`, builds a `GeometryContext`, calls the builder, and
 * emits the resulting SVG via `<FloorplanGeometryRenderer>`. Each entry
 * is wrapped in an interactive `<g>` that handles:
 *
 *  - **Click → select**. Sets `useViewer.selection.selectedIds = [id]`.
 *  - **Drag → move**. Pure imperative translation via the wrapping `<g>`'s
 *    transform attribute during drag; one `updateNode(id, { position })`
 *    call on pointerup. Same pattern as `MoveRegistryNodeTool` (the
 *    validated "smooth move" from Phase 2/3): no per-tick store update,
 *    no re-render storm, no zundo bloat. Only the dragged node mutates.
 *
 * Coexists with the legacy `floorplan-panel.tsx` inline rendering —
 * unmigrated kinds keep their hand-written branches. As each kind ports
 * `def.floorplan`, its inline equivalent becomes dead code and gets
 * removed in the same PR.
 *
 * Coordinates are level-local meters; the parent SVG handles world→SVG
 * transform via its viewBox.
 */
export const FloorplanRegistryLayer = memo(function FloorplanRegistryLayer() {
  const levelId = useViewer((s) => s.selection.levelId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)

  // Drag state — tracks the active pointer drag across global pointermove
  // / pointerup so the pointer can leave the dragged element without
  // breaking the gesture. Imperative DOM updates avoid React re-renders;
  // store update happens once on commit.
  const dragRef = useRef<{
    id: AnyNodeId
    pointerId: number
    startSvgX: number
    startSvgY: number
    originalPosition: [number, number, number]
    element: SVGGElement
    moved: boolean
  } | null>(null)

  const handlePointerDown = useCallback(
    (id: AnyNodeId, event: React.PointerEvent<SVGGElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()

      const node = useScene.getState().nodes[id]
      if (!node || typeof (node as { position?: unknown }).position === 'undefined') return
      const position = (node as unknown as { position: [number, number, number] }).position
      if (!Array.isArray(position) || position.length < 3) return

      const svg = event.currentTarget.ownerSVGElement
      if (!svg) return
      const pt = svgPoint(svg, event.clientX, event.clientY)

      setSelection({ selectedIds: [id] })

      dragRef.current = {
        id,
        pointerId: event.pointerId,
        startSvgX: pt.x,
        startSvgY: pt.y,
        originalPosition: [position[0], position[1], position[2]],
        element: event.currentTarget,
        moved: false,
      }
      // Pause undo while we drag so the commit on pointerup lands as a
      // single history step. Resume in the pointerup handler.
      useScene.temporal.getState().pause()
    },
    [setSelection],
  )

  // Global pointermove / pointerup so the drag survives the cursor
  // leaving the entry's bounding box.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const svg = drag.element.ownerSVGElement
      if (!svg) return
      const pt = svgPoint(svg, event.clientX, event.clientY)
      const dx = pt.x - drag.startSvgX
      const dy = pt.y - drag.startSvgY
      if (!drag.moved && (dx !== 0 || dy !== 0)) drag.moved = true
      drag.element.setAttribute('transform', `translate(${dx} ${dy})`)
    }

    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      // Clear the imperative override before committing; the store update
      // will re-render the entry with the new position baked in via the
      // builder, so the temporary transform is no longer needed.
      drag.element.removeAttribute('transform')

      if (drag.moved) {
        const svg = drag.element.ownerSVGElement
        if (svg) {
          const pt = svgPoint(svg, event.clientX, event.clientY)
          const dx = pt.x - drag.startSvgX
          const dy = pt.y - drag.startSvgY
          const [ox, oy, oz] = drag.originalPosition
          useScene
            .getState()
            .updateNode(drag.id, { position: [ox + dx, oy, oz + dy] } as Partial<AnyNode>)
        }
      }

      useScene.temporal.getState().resume()
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const entries = useMemo(() => {
    if (!levelId) return []
    const out: {
      id: AnyNodeId
      node: AnyNode
      geometry: FloorplanGeometry
    }[] = []

    const visit = (id: AnyNodeId) => {
      const node = nodes[id]
      if (!node) return
      const def = nodeRegistry.get(node.type)
      const builder = def?.floorplan
      if (builder) {
        const ctx = buildContext(node, nodes)
        const geometry = (builder as (n: AnyNode, c: GeometryContext) => FloorplanGeometry | null)(
          node,
          ctx,
        )
        if (geometry) out.push({ id, node, geometry })
      }
      const childIds = (node as unknown as { children?: AnyNodeId[] }).children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) visit(cid)
      }
    }

    visit(levelId as AnyNodeId)
    return out
  }, [levelId, nodes])

  if (entries.length === 0) return null

  return (
    <g className="floorplan-registry-layer">
      {entries.map(({ id, geometry }) => {
        const isSelected = selectedIds.includes(id)
        return (
          <g
            className={
              isSelected ? 'floorplan-registry-entry selected' : 'floorplan-registry-entry'
            }
            data-node-id={id}
            key={id}
            onPointerDown={(e) => handlePointerDown(id, e)}
            style={{ cursor: 'grab' }}
          >
            <FloorplanGeometryRenderer geometry={geometry} />
            {isSelected && <SelectionOutline geometry={geometry} />}
          </g>
        )
      })}
    </g>
  )
})

function SelectionOutline({ geometry }: { geometry: FloorplanGeometry }) {
  return (
    <g pointerEvents="none">
      <FloorplanGeometryRenderer geometry={withSelectionStyle(geometry)} />
    </g>
  )
}

function withSelectionStyle(g: FloorplanGeometry): FloorplanGeometry {
  const accent = { stroke: '#818cf8', strokeWidth: 0.04, fill: 'none', opacity: 1 }
  if (g.kind === 'group') {
    return { ...g, children: g.children.map(withSelectionStyle) }
  }
  return { ...g, ...accent }
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const transformed = pt.matrixTransform(ctm.inverse())
  return { x: transformed.x, y: transformed.y }
}

function buildContext(node: AnyNode, nodes: Record<string, AnyNode>): GeometryContext {
  const resolve = <N = AnyNode>(id: AnyNodeId): N | undefined => nodes[id] as N | undefined

  const childIds = (node as unknown as { children?: AnyNodeId[] }).children
  const children: AnyNode[] = Array.isArray(childIds)
    ? childIds.map((cid) => nodes[cid]).filter((n): n is AnyNode => n !== undefined)
    : []

  const parentId = node.parentId as AnyNodeId | null
  const parent: AnyNode | null = parentId ? (nodes[parentId] ?? null) : null

  let siblings: AnyNode[] = []
  if (parent) {
    const parentChildIds = (parent as unknown as { children?: AnyNodeId[] }).children
    if (Array.isArray(parentChildIds)) {
      for (const sid of parentChildIds) {
        if (sid === node.id) continue
        const s = nodes[sid]
        if (s && s.type === node.type) siblings.push(s)
      }
    } else {
      siblings = Object.values(nodes).filter(
        (n) => n !== node && n.type === node.type && n.parentId === parentId,
      )
    }
  }

  return { resolve, children, siblings, parent }
}
