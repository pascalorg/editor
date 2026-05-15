'use client'

import { type AnyNode, type AnyNodeId, nodeRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { NodeActionMenu } from '../editor/node-action-menu'

/**
 * Floating Move / Duplicate / Delete buttons that appear above the
 * selected registered kind in the floor plan view.
 *
 * Lives outside the floorplan-panel.tsx monolith. Reads selection from
 * `useViewer`, finds the rendered `[data-node-id]` <g> inside the floor
 * plan scene, polls its bounding rect via rAF while open, and portals
 * an HTML overlay positioned at the top of the bounding box.
 *
 * Buttons:
 *  - Move: sets `movingNode` in useEditor. The `<FloorplanRegistryMove
 *    Overlay>` component picks that up and lets the user click in the
 *    floor plan to commit the new position.
 *  - Duplicate: deep-clones the node, marks it new, sets it as the
 *    movingNode (placement cursor) — same UX pattern as 3D duplicate.
 *  - Delete: calls `deleteNode(id)`. Cascade is handled by the registry's
 *    `relations.cascadeDelete` if declared on the def.
 *
 * Hidden while in a move state (so we don't show buttons over a ghost).
 */
export function FloorplanRegistryActionMenu() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0]) as AnyNodeId | undefined
  const movingNode = useEditor((s) => s.movingNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Only show for registered kinds (skip legacy kinds — they have their
  // own FloorplanActionMenuLayer entries).
  const selectedKind = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))
  const def = selectedKind ? nodeRegistry.get(selectedKind) : null
  const isRegistryKind = !!def
  const isVisible = isRegistryKind && !movingNode

  useEffect(() => {
    if (!(isVisible && selectedId)) {
      setPosition(null)
      return
    }
    let raf = 0
    const tick = () => {
      const el = document.querySelector(
        `[data-floorplan-scene] [data-node-id="${selectedId}"]`,
      ) as SVGGElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        // Position centered horizontally, ~12px above the bounding box.
        setPosition({ left: rect.left + rect.width / 2, top: rect.top - 12 })
      } else {
        setPosition(null)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVisible, selectedId])

  if (!(isVisible && selectedId && position && def)) return null

  const node = useScene.getState().nodes[selectedId]
  if (!node) return null

  const canMove = !!def.capabilities.movable
  const canDuplicate = def.capabilities.duplicable !== false
  const canDelete = def.capabilities.deletable !== false

  const handleMove = () => {
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node as never)
    // Selection stays — the move overlay reads movingNode, not selection.
  }

  const handleDuplicate = () => {
    if (!node.parentId) return
    sfxEmitter.emit('sfx:item-pick')
    useScene.temporal.getState().pause()
    const cloned = structuredClone(node) as AnyNode & { id?: AnyNodeId }
    delete (cloned as { id?: AnyNodeId }).id
    const prevMeta =
      cloned.metadata && typeof cloned.metadata === 'object' && !Array.isArray(cloned.metadata)
        ? (cloned.metadata as Record<string, unknown>)
        : {}
    cloned.metadata = { ...prevMeta, isNew: true }
    const parsed = def.schema.parse(cloned) as AnyNode
    useScene.getState().createNode(parsed, node.parentId as AnyNodeId)
    setMovingNode(parsed as never)
    useScene.temporal.getState().resume()
  }

  const handleDelete = () => {
    sfxEmitter.emit('sfx:item-delete')
    useScene.getState().deleteNode(selectedId)
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  return createPortal(
    <div
      className="pointer-events-none fixed z-30"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <NodeActionMenu
        onDelete={canDelete ? handleDelete : undefined}
        onDuplicate={canDuplicate ? handleDuplicate : undefined}
        onMove={canMove ? handleMove : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  )
}
