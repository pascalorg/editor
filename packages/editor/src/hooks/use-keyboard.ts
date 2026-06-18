import { type AnyNode, type AnyNodeId, emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { closeDoorOpenState, toggleDoorOpenState } from '../lib/door-interaction'
import { runRedo, runUndo } from '../lib/history'
import { groupSelectedNodes, ungroupAssembly } from '../lib/manual-assembly-actions'
import { isPlanDragMovableNode } from '../lib/plan-drag'
import {
  copySelectedNodesToEditorClipboard,
  pasteEditorClipboardToLevel,
} from '../lib/scene-clipboard'
import { sfxEmitter } from '../lib/sfx-bus'
import { closeWindowOpenState, toggleWindowOpenState } from '../lib/window-interaction'
import useEditor from '../store/use-editor'

// Tools call this in their onCancel handler when they have an active mid-action to cancel,
// so that the global Escape handler knows not to also switch to select mode.
let _toolCancelConsumed = false
export const markToolCancelConsumed = () => {
  _toolCancelConsumed = true
}

function isEditableTarget(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('[contenteditable="true"], [role="dialog"]'))
  )
}

function hasBrowserTextSelection() {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
}

const ARROW_NUDGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

function getPlanNudgeDelta(key: string, step: number): [number, number, number] | null {
  if (key === 'ArrowLeft') return [-step, 0, 0]
  if (key === 'ArrowRight') return [step, 0, 0]
  if (key === 'ArrowUp') return [0, 0, -step]
  if (key === 'ArrowDown') return [0, 0, step]
  return null
}

function getPositionPatchForPlanNudge(node: AnyNode, delta: [number, number, number]) {
  if (!isPlanDragMovableNode(node)) return null

  if (
    node.type === 'cable-tray' ||
    node.type === 'pipe' ||
    node.type === 'road' ||
    node.type === 'steel-beam' ||
    node.type === 'wall' ||
    node.type === 'fence'
  ) {
    return {
      start: [node.start[0] + delta[0], node.start[1] + delta[2]] as [number, number],
      end: [node.end[0] + delta[0], node.end[1] + delta[2]] as [number, number],
    }
  }

  const position = (node as { position?: unknown }).position
  if (!Array.isArray(position) || position.length < 3) return null
  const [x, y, z] = position
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  return { position: [x + delta[0], y, z + delta[2]] as [number, number, number] }
}

function nudgeSelectedNodesOnPlan(key: string, step: number): boolean {
  const delta = getPlanNudgeDelta(key, step)
  if (!delta) return false

  const scene = useScene.getState()
  const selectedIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
  const updates = selectedIds.flatMap((id) => {
    const node = scene.nodes[id]
    const data = node ? getPositionPatchForPlanNudge(node, delta) : null
    return data ? [{ id, data }] : []
  })

  if (updates.length === 0) return false
  scene.updateNodes(updates)
  return true
}

export function deleteSelectedNodeIds(selectedNodeIds: readonly AnyNodeId[]) {
  if (selectedNodeIds.length === 0) return

  if (selectedNodeIds.length === 1) {
    const node = useScene.getState().nodes[selectedNodeIds[0]!]
    if (node?.type === 'item') {
      sfxEmitter.emit('sfx:item-delete')
    } else {
      sfxEmitter.emit('sfx:structure-delete')
    }
  } else {
    sfxEmitter.emit('sfx:structure-delete')
  }

  useScene.getState().deleteNodes([...selectedNodeIds])
}

export const useKeyboard = ({
  isVersionPreviewMode = false,
  disabled = false,
  onRequestDeleteSelectedNodes,
}: {
  isVersionPreviewMode?: boolean
  disabled?: boolean
  onRequestDeleteSelectedNodes?: (selectedNodeIds: AnyNodeId[]) => void
} = {}) => {
  useEffect(() => {
    if (disabled) {
      return
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (isEditableTarget(e.target)) {
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && hasBrowserTextSelection()) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        _toolCancelConsumed = false
        emitter.emit('tool:cancel')

        // Only switch to select mode if no tool had an active mid-action to cancel.
        // (e.g. mid-wall draw or mid-slab polygon should only cancel the action, not exit the tool)
        if (!_toolCancelConsumed) {
          const currentPhase = useEditor.getState().phase
          const currentStructureLayer = useEditor.getState().structureLayer

          useEditor.getState().setEditingHole(null)
          useEditor.getState().setEditingAssemblyId(null)

          // From zone mode, return to structure select
          if (currentPhase === 'structure' && currentStructureLayer === 'zones') {
            useEditor.getState().setStructureLayer('elements')
            useEditor.getState().setMode('select')
          } else {
            // Return to the default select tool while keeping the active building/level context.
            useEditor.getState().setMode('select')
          }

          useEditor.getState().setSelectedItem(null)
          useEditor.getState().setFloorplanSelectionTool('click')

          // Clear selections to close UI panels, but KEEP the active building and level context.
          useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
          useEditor.getState().setSelectedReferenceId(null)
        }
      } else if (e.key === '1' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('site')
        useEditor.getState().setMode('select')
      } else if (e.key === '2' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setMode('select')
      } else if (e.key === '3' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('furnish')
        useEditor.getState().setMode('select')
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('industrial')
        useEditor.getState().setMode('build')
      } else if (e.key === 'z' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('zones')
        useEditor.getState().setMode('build')
      }
      if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setMode('select')
        useEditor.getState().setFloorplanSelectionTool('click')
      } else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('elements')
        useEditor.getState().setMode('build')
      } else if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().setMode('delete')
      } else if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isVersionPreviewMode) return
        if (groupSelectedNodes()) {
          e.preventDefault()
          sfxEmitter.emit('sfx:item-place')
        }
      } else if (e.key.toLowerCase() === 'u' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isVersionPreviewMode) return
        if (ungroupAssembly()) {
          e.preventDefault()
          sfxEmitter.emit('sfx:structure-delete')
        }
      } else if (e.key === 'c' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        copySelectedNodesToEditorClipboard()
      } else if (e.key === 'v' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        const result = pasteEditorClipboardToLevel()
        if (result?.pastedIds.length) {
          sfxEmitter.emit('sfx:item-place')
        }
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        runUndo()
      } else if (e.key === 'Z' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        runRedo()
      } else if (
        ARROW_NUDGE_KEYS.has(e.key) &&
        !e.metaKey &&
        !e.ctrlKey &&
        useEditor.getState().mode === 'select' &&
        !useEditor.getState().movingNode
      ) {
        if (isVersionPreviewMode) return
        const step = e.altKey ? 0.01 : e.shiftKey ? 0.25 : 0.05
        if (nudgeSelectedNodesOnPlan(e.key, step)) {
          e.preventDefault()
        }
      } else if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const { buildingId, levelId } = useViewer.getState().selection
        if (buildingId) {
          const building = useScene.getState().nodes[buildingId]
          const levels =
            building?.type === 'building'
              ? building.children.filter(
                  (childId) => useScene.getState().nodes[childId as AnyNodeId]?.type === 'level',
                )
              : []
          if (levels.length > 0) {
            const currentIdx = levelId ? levels.indexOf(levelId as any) : -1
            const nextIdx = currentIdx < levels.length - 1 ? currentIdx + 1 : currentIdx
            if (nextIdx !== -1 && nextIdx !== currentIdx) {
              useViewer.getState().setSelection({ levelId: levels[nextIdx] as any })
            } else if (currentIdx === -1) {
              useViewer.getState().setSelection({ levelId: levels[0] as any })
            }
          }
        }
      } else if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const { buildingId, levelId } = useViewer.getState().selection
        if (buildingId) {
          const building = useScene.getState().nodes[buildingId]
          const levels =
            building?.type === 'building'
              ? building.children.filter(
                  (childId) => useScene.getState().nodes[childId as AnyNodeId]?.type === 'level',
                )
              : []
          if (levels.length > 0) {
            const currentIdx = levelId ? levels.indexOf(levelId as any) : -1
            const prevIdx = currentIdx > 0 ? currentIdx - 1 : currentIdx
            if (prevIdx !== -1 && prevIdx !== currentIdx) {
              useViewer.getState().setSelection({ levelId: levels[prevIdx] as any })
            } else if (currentIdx === -1) {
              useViewer.getState().setSelection({ levelId: levels[levels.length - 1] as any })
            }
          }
        }
      } else if ((e.key === 'r' || e.key === 'R') && !isVersionPreviewMode) {
        // Rotate selected node clockwise if it supports rotation (items, roofs, etc.)
        // Operable doors/windows use R to toggle their open/closed state.
        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
        if (selectedNodeIds.length === 1) {
          const node = useScene.getState().nodes[selectedNodeIds[0]!]
          if (node?.type === 'door') {
            e.preventDefault()
            if (node.openingKind !== 'opening') {
              toggleDoorOpenState(node.id)
              sfxEmitter.emit('sfx:item-rotate')
            }
          } else if (
            node?.type === 'window' &&
            node.openingKind !== 'opening' &&
            (node.windowType === 'sliding' ||
              node.windowType === 'casement' ||
              node.windowType === 'awning' ||
              node.windowType === 'hopper' ||
              node.windowType === 'single-hung' ||
              node.windowType === 'double-hung' ||
              node.windowType === 'louvered')
          ) {
            e.preventDefault()
            toggleWindowOpenState(node.id)
            sfxEmitter.emit('sfx:item-rotate')
          } else if (node && 'rotation' in node) {
            e.preventDefault()
            const ROTATION_STEP = Math.PI / 4

            // Handle different rotation types (number for roof, array for items/windows/doors)
            if (typeof node.rotation === 'number') {
              useScene.getState().updateNode(node.id, { rotation: node.rotation + ROTATION_STEP })
            } else if (Array.isArray(node.rotation)) {
              useScene.getState().updateNode(node.id, {
                rotation: [node.rotation[0], node.rotation[1] + ROTATION_STEP, node.rotation[2]],
              })
            }
            sfxEmitter.emit('sfx:item-rotate')
          }
        }
      } else if ((e.key === 't' || e.key === 'T') && !isVersionPreviewMode) {
        // Rotate selected node counter-clockwise
        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
        if (selectedNodeIds.length === 1) {
          const node = useScene.getState().nodes[selectedNodeIds[0]!]
          if (node?.type === 'door') {
            e.preventDefault()
            if (node.openingKind !== 'opening') {
              closeDoorOpenState(node.id)
              sfxEmitter.emit('sfx:item-rotate')
            }
          } else if (
            node?.type === 'window' &&
            node.openingKind !== 'opening' &&
            (node.windowType === 'sliding' ||
              node.windowType === 'casement' ||
              node.windowType === 'awning' ||
              node.windowType === 'hopper' ||
              node.windowType === 'single-hung' ||
              node.windowType === 'double-hung' ||
              node.windowType === 'louvered')
          ) {
            e.preventDefault()
            closeWindowOpenState(node.id)
            sfxEmitter.emit('sfx:item-rotate')
          } else if (node && 'rotation' in node) {
            e.preventDefault()
            const ROTATION_STEP = Math.PI / 4

            if (typeof node.rotation === 'number') {
              useScene.getState().updateNode(node.id, { rotation: node.rotation - ROTATION_STEP })
            } else if (Array.isArray(node.rotation)) {
              useScene.getState().updateNode(node.id, {
                rotation: [node.rotation[0], node.rotation[1] - ROTATION_STEP, node.rotation[2]],
              })
            }
            sfxEmitter.emit('sfx:item-rotate')
          }
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isVersionPreviewMode) {
        e.preventDefault()

        // Check for a selected reference (guide/scan) first
        const selectedRefId = useEditor.getState().selectedReferenceId
        if (selectedRefId) {
          const refNode = useScene.getState().nodes[selectedRefId as AnyNodeId]
          if (refNode && (refNode.type === 'guide' || refNode.type === 'scan')) {
            sfxEmitter.emit('sfx:structure-delete')
            useScene.getState().deleteNode(selectedRefId as AnyNodeId)
            useEditor.getState().setSelectedReferenceId(null)
            return
          }
        }

        // Delete selected zone
        const selectedZoneId = useViewer.getState().selection.zoneId
        if (selectedZoneId) {
          sfxEmitter.emit('sfx:structure-delete')
          useScene.getState().deleteNode(selectedZoneId as AnyNodeId)
          useViewer.getState().setSelection({ zoneId: null })
          return
        }

        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]

        if (selectedNodeIds.length > 0) {
          if (selectedNodeIds.length > 1) {
            if (onRequestDeleteSelectedNodes) {
              onRequestDeleteSelectedNodes([...selectedNodeIds])
            } else {
              deleteSelectedNodeIds(selectedNodeIds)
            }
            return
          }

          deleteSelectedNodeIds(selectedNodeIds)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, isVersionPreviewMode, onRequestDeleteSelectedNodes])

  return null
}
