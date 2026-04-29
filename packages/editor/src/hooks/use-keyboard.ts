import { type AnyNodeId, emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { runRedo, runUndo } from '../lib/history'
import { sfxEmitter } from '../lib/sfx-bus'
import useEditor from '../store/use-editor'

// Tools call this in their onCancel handler when they have an active mid-action to cancel,
// so that the global Escape handler knows not to also switch to select mode.
let _toolCancelConsumed = false
export const markToolCancelConsumed = () => {
  _toolCancelConsumed = true
}

export const useKeyboard = ({
  isVersionPreviewMode = false,
  disabled = false,
}: {
  isVersionPreviewMode?: boolean
  disabled?: boolean
} = {}) => {
  useEffect(() => {
    if (disabled) {
      return
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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

          // From zone mode, return to structure select
          if (currentPhase === 'structure' && currentStructureLayer === 'zones') {
            useEditor.getState().setStructureLayer('elements')
            useEditor.getState().setMode('select')
          } else {
            // Return to the default select tool while keeping the active building/level context.
            useEditor.getState().setMode('select')
          }

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
        useEditor.getState().setPhase('furnish')
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
      } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().primeMaterialPaintFromSelection()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('elements')
        useEditor.getState().setMode('material-paint')
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        runUndo()
      } else if (e.key === 'Z' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        runRedo()
      } else if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const { buildingId, levelId } = useViewer.getState().selection
        if (buildingId) {
          const building = useScene.getState().nodes[buildingId]
          if (building && building.type === 'building' && building.children.length > 0) {
            const currentIdx = levelId ? building.children.indexOf(levelId as any) : -1
            const nextIdx = currentIdx < building.children.length - 1 ? currentIdx + 1 : currentIdx
            if (nextIdx !== -1 && nextIdx !== currentIdx) {
              useViewer.getState().setSelection({ levelId: building.children[nextIdx] as any })
            } else if (currentIdx === -1) {
              useViewer.getState().setSelection({ levelId: building.children[0] as any })
            }
          }
        }
      } else if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const { buildingId, levelId } = useViewer.getState().selection
        if (buildingId) {
          const building = useScene.getState().nodes[buildingId]
          if (building && building.type === 'building' && building.children.length > 0) {
            const currentIdx = levelId ? building.children.indexOf(levelId as any) : -1
            const prevIdx = currentIdx > 0 ? currentIdx - 1 : currentIdx
            if (prevIdx !== -1 && prevIdx !== currentIdx) {
              useViewer.getState().setSelection({ levelId: building.children[prevIdx] as any })
            } else if (currentIdx === -1) {
              useViewer
                .getState()
                .setSelection({ levelId: building.children[building.children.length - 1] as any })
            }
          }
        }
      } else if ((e.key === 'r' || e.key === 'R') && !isVersionPreviewMode) {
        // Rotate selected node clockwise if it supports rotation (items, roofs, etc.)
        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
        if (selectedNodeIds.length === 1) {
          const node = useScene.getState().nodes[selectedNodeIds[0]!]
          if (node && 'rotation' in node) {
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
          if (node && 'rotation' in node) {
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
          // Play appropriate SFX based on what's being deleted
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

          useScene.getState().deleteNodes(selectedNodeIds)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, isVersionPreviewMode])

  return null
}
