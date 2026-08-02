'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { isActive } from '../../lib/interaction/scope'
import {
  canCreateSessionGroup,
  selectionIntersectsSessionGroup,
} from '../../lib/session-groups'
import useEditor from '../../store/use-editor'
import useInteractionScope, { useMovingNode } from '../../store/use-interaction-scope'
import useSessionGroups, {
  groupCurrentSelection,
  ungroupCurrentSelection,
} from '../../store/use-session-groups'
import {
  deleteSelection,
  duplicateSelectionAndPickUp,
  startGroupPickUp,
} from '../editor/group-actions'
import { NodeActionMenu } from '../editor/node-action-menu'

/**
 * Floating multi-select pill on the floor plan: Move, Group, Ungroup, Duplicate, Delete.
 */
export function FloorplanGroupActionMenu() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const isMultiSelect = selectedIds.length > 1
  const movingNode = useMovingNode()
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const scopeActive = useInteractionScope((s) => isActive(s.scope))
  const sessionGroups = useSessionGroups((s) => s.groups)
  const sceneNodes = useScene((s) => s.nodes)
  const liveIds = useMemo(() => new Set(Object.keys(sceneNodes)), [sceneNodes])
  const showGroup = useMemo(
    () => canCreateSessionGroup(sessionGroups, selectedIds, liveIds),
    [sessionGroups, selectedIds, liveIds],
  )
  const showUngroup = useMemo(
    () => selectionIntersectsSessionGroup(sessionGroups, selectedIds, liveIds),
    [sessionGroups, selectedIds, liveIds],
  )

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
        onGroup={showGroup ? () => groupCurrentSelection() : undefined}
        onMove={() => startGroupPickUp()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onUngroup={showUngroup ? () => ungroupCurrentSelection() : undefined}
      />
    </div>,
    document.body,
  )
}
