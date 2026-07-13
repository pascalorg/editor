'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { isActive } from '../../lib/interaction/scope'
import useEditor from '../../store/use-editor'
import useInteractionScope, { useMovingNode } from '../../store/use-interaction-scope'
import {
  deleteSelection,
  duplicateSelectionAndPickUp,
  startGroupPickUp,
} from '../editor/group-actions'
import { NodeActionMenu } from '../editor/node-action-menu'

/**
 * Floating Move / Duplicate / Delete pill for a MULTI-selection in the 2D
 * floor plan — the group sibling of `FloorplanRegistryActionMenu` (which is
 * sole-selection only). Anchored above the dashed group selection box; every
 * action targets the whole selection: Move picks the group up (it rides the
 * cursor until a click places it), Duplicate clones the selection and picks
 * the clones up, Delete removes everything selected.
 *
 * Gated on floorplan hover so it never coexists with the 3D group menu in
 * split view (that one hides while the floor plan is hovered), and hidden
 * during any active interaction so it never competes with a live drag.
 */
export function FloorplanGroupActionMenu() {
  const isMultiSelect = useViewer((s) => s.selection.selectedIds.length > 1)
  const movingNode = useMovingNode()
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const scopeActive = useInteractionScope((s) => isActive(s.scope))

  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const isVisible = isMultiSelect && !movingNode && isFloorplanHovered && !scopeActive

  useEffect(() => {
    if (!isVisible) {
      setPosition(null)
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      // The dashed group box exists exactly while the multi-selection has
      // transformable participants — anchor to its top edge. Only publish
      // actual changes so the idle poll doesn't re-render every frame.
      const box = document.querySelector('[data-group-selection-box]') as SVGGElement | null
      if (!box) {
        setPosition((prev) => (prev === null ? prev : null))
        return
      }
      const rect = box.getBoundingClientRect()
      const next = { left: rect.left + rect.width / 2, top: rect.top }
      setPosition((prev) =>
        prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5
          ? prev
          : next,
      )
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVisible])

  if (!(isVisible && position)) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-30"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, calc(-100% - 12px))',
      }}
    >
      <NodeActionMenu
        onDelete={() => deleteSelection()}
        onDuplicate={() => duplicateSelectionAndPickUp()}
        onMove={() => startGroupPickUp()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  )
}
