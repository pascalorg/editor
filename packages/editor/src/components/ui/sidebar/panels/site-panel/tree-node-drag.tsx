'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { motion } from 'motion/react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

// ---------------------------------------------------------------------------
// Reparenting rules
// ---------------------------------------------------------------------------

// Maps a draggable node type to the parent types it can be dropped into.
const REPARENT_TARGETS: Record<string, string[]> = {
  'roof-segment': ['roof'],
}

// Container types that should be auto-removed when all children are moved out.
const REMOVE_WHEN_EMPTY = new Set(['roof'])

export function canDrag(node: AnyNode): boolean {
  return node.type in REPARENT_TARGETS
}

export function canDrop(draggedType: string, targetType: string): boolean {
  return REPARENT_TARGETS[draggedType]?.includes(targetType) ?? false
}

// ---------------------------------------------------------------------------
// Coordinate preservation
// ---------------------------------------------------------------------------

type Transform = {
  position: [number, number, number]
  rotation: number
}

function getTransform(node: AnyNode): Transform {
  const pos =
    'position' in node && Array.isArray(node.position)
      ? (node.position as [number, number, number])
      : ([0, 0, 0] as [number, number, number])
  const rot = 'rotation' in node && typeof node.rotation === 'number' ? node.rotation : 0
  return { position: pos, rotation: rot }
}

/**
 * Compute new local position + rotation so the child stays at the same
 * absolute grid position when moved from oldParent to newParent.
 */
function computeReparentTransform(
  child: Transform,
  oldParent: Transform,
  newParent: Transform,
): Transform {
  // child → world: world = parentPos + rotateY(childPos, parentRot)
  const cosOld = Math.cos(oldParent.rotation)
  const sinOld = Math.sin(oldParent.rotation)
  const absX = oldParent.position[0] + child.position[0] * cosOld + child.position[2] * sinOld
  const absY = oldParent.position[1] + child.position[1]
  const absZ = oldParent.position[2] - child.position[0] * sinOld + child.position[2] * cosOld

  // world → newParent local: rotateY_inverse(world - newParentPos, newParentRot)
  const dx = absX - newParent.position[0]
  const dy = absY - newParent.position[1]
  const dz = absZ - newParent.position[2]
  const cosNew = Math.cos(-newParent.rotation)
  const sinNew = Math.sin(-newParent.rotation)

  return {
    position: [dx * cosNew + dz * sinNew, dy, -dx * sinNew + dz * cosNew],
    rotation: oldParent.rotation + child.rotation - newParent.rotation,
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DragState = {
  nodeId: string
  nodeType: string
  sourceParentId: string
  label: string
  pointerX: number
  pointerY: number
} | null

type DropTarget = {
  parentId: string
  insertIndex: number
} | null

type TreeNodeDragContextValue = {
  drag: DragState
  dropTarget: DropTarget
  startDrag: (
    nodeId: string,
    nodeType: string,
    sourceParentId: string,
    label: string,
    x: number,
    y: number,
  ) => void
  isDragging: boolean
}

const TreeNodeDragContext = createContext<TreeNodeDragContextValue>({
  drag: null,
  dropTarget: null,
  startDrag: () => {},
  isDragging: false,
})

export const useTreeNodeDrag = () => useContext(TreeNodeDragContext)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD = 4

export function TreeNodeDragProvider({ children }: { children: ReactNode }) {
  const [drag, setDrag] = useState<DragState>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const pendingRef = useRef<{
    nodeId: string
    nodeType: string
    sourceParentId: string
    label: string
    startX: number
    startY: number
  } | null>(null)

  const commitDrop = useCallback(() => {
    if (!(drag && dropTarget)) return

    const state = useScene.getState()

    if (dropTarget.parentId === drag.sourceParentId) {
      // --- Reorder within same parent ---
      const parent = state.nodes[dropTarget.parentId as AnyNodeId]
      if (parent && 'children' in parent && Array.isArray(parent.children)) {
        const currentChildren = [...parent.children] as string[]
        const fromIndex = currentChildren.indexOf(drag.nodeId)
        if (fromIndex === -1) return
        currentChildren.splice(fromIndex, 1)
        const toIndex = Math.min(dropTarget.insertIndex, currentChildren.length)
        currentChildren.splice(toIndex, 0, drag.nodeId)
        state.updateNode(dropTarget.parentId as AnyNodeId, { children: currentChildren } as any)
      }
    } else {
      // --- Reparent to different parent, preserving world position ---
      const node = state.nodes[drag.nodeId as AnyNodeId]
      const oldParent = state.nodes[drag.sourceParentId as AnyNodeId]
      const newParent = state.nodes[dropTarget.parentId as AnyNodeId]
      if (!(node && oldParent && newParent)) return

      const newLocal = computeReparentTransform(
        getTransform(node),
        getTransform(oldParent),
        getTransform(newParent),
      )

      state.updateNode(
        drag.nodeId as AnyNodeId,
        {
          parentId: dropTarget.parentId,
          position: newLocal.position,
          rotation: newLocal.rotation,
        } as any,
      )

      // Place at the correct index within the new parent's children
      const updatedParent = state.nodes[dropTarget.parentId as AnyNodeId]
      if (updatedParent && 'children' in updatedParent && Array.isArray(updatedParent.children)) {
        const children = [...updatedParent.children] as string[]
        const idx = children.indexOf(drag.nodeId)
        if (idx !== -1) {
          children.splice(idx, 1)
          const toIndex = Math.min(dropTarget.insertIndex, children.length)
          children.splice(toIndex, 0, drag.nodeId)
          state.updateNode(dropTarget.parentId as AnyNodeId, { children } as any)
        }
      }

      // Lifecycle: remove old parent if it's now empty and in REMOVE_WHEN_EMPTY
      const staleParent = state.nodes[drag.sourceParentId as AnyNodeId]
      if (
        staleParent &&
        REMOVE_WHEN_EMPTY.has(staleParent.type) &&
        'children' in staleParent &&
        Array.isArray(staleParent.children) &&
        staleParent.children.length === 0
      ) {
        state.deleteNode(drag.sourceParentId as AnyNodeId)
      }
    }
  }, [drag, dropTarget])

  const startDrag = useCallback(
    (
      nodeId: string,
      nodeType: string,
      sourceParentId: string,
      label: string,
      x: number,
      y: number,
    ) => {
      pendingRef.current = { nodeId, nodeType, sourceParentId, label, startX: x, startY: y }
    },
    [],
  )

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (pendingRef.current && !drag) {
        const dx = e.clientX - pendingRef.current.startX
        const dy = e.clientY - pendingRef.current.startY
        if (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD) {
          const p = pendingRef.current
          setDrag({
            nodeId: p.nodeId,
            nodeType: p.nodeType,
            sourceParentId: p.sourceParentId,
            label: p.label,
            pointerX: e.clientX,
            pointerY: e.clientY,
          })
        }
        return
      }

      if (!drag) return

      setDrag((prev) => (prev ? { ...prev, pointerX: e.clientX, pointerY: e.clientY } : null))

      // Hit-test for drop targets
      const els = document.elementsFromPoint(e.clientX, e.clientY)
      let foundTarget: DropTarget = null

      for (const el of els) {
        const targetEl = (el as HTMLElement).closest?.('[data-drop-target]') as HTMLElement | null
        if (!targetEl) continue

        const parentId = targetEl.dataset.dropTarget!

        // Validate this is a legal drop
        const targetNode = useScene.getState().nodes[parentId as AnyNodeId]
        if (!(targetNode && canDrop(drag.nodeType, targetNode.type))) continue

        // Find child rows to determine insert index
        const childRows = targetEl.querySelectorAll<HTMLElement>('[data-drop-child]')
        let insertIndex = childRows.length

        for (let i = 0; i < childRows.length; i++) {
          const row = childRows[i]!
          const rect = row.getBoundingClientRect()
          const midY = rect.top + rect.height / 2
          if (e.clientY < midY) {
            insertIndex = i
            break
          }
        }

        foundTarget = { parentId, insertIndex }
        break
      }

      setDropTarget(foundTarget)
    }

    const handlePointerUp = () => {
      if (drag) {
        commitDrop()
      }
      pendingRef.current = null
      setDrag(null)
      setDropTarget(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [drag, commitDrop])

  const isDragging = drag !== null

  return (
    <TreeNodeDragContext.Provider value={{ drag, dropTarget, startDrag, isDragging }}>
      {isDragging && <style>{'* { cursor: grabbing !important; }'}</style>}
      {children}
      {drag && <FloatingPreview drag={drag} />}
    </TreeNodeDragContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Floating preview (portal)
// ---------------------------------------------------------------------------

function FloatingPreview({ drag }: { drag: NonNullable<DragState> }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-[200] flex items-center gap-1.5 rounded-lg border border-accent bg-background/95 px-2.5 py-1.5 font-medium text-foreground text-xs shadow-xl backdrop-blur-sm"
      style={{
        left: drag.pointerX + 12,
        top: drag.pointerY - 14,
      }}
    >
      <span className="opacity-60">↕</span>
      {drag.label}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Drop indicator line
// ---------------------------------------------------------------------------

export function DropIndicatorLine() {
  return (
    <motion.div
      animate={{ height: 2, opacity: 1 }}
      className="pointer-events-none mx-3 rounded-full bg-blue-500"
      exit={{ height: 0, opacity: 0 }}
      initial={{ height: 0, opacity: 0 }}
      transition={{ type: 'spring', bounce: 0.3, duration: 0.25 }}
    />
  )
}
