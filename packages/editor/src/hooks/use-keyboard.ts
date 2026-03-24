import { type AnyNodeId, emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { sfxEmitter } from '../lib/sfx-bus'
import useEditor from '../store/use-editor'

export const useKeyboard = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        emitter.emit('tool:cancel')

        // Return to the default select tool while keeping the active building/level context.
        useEditor.getState().setEditingHole(null)
        useEditor.getState().setMode('select')

        // Clear selections to close UI panels, but KEEP the active building and level context.
        useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
        useEditor.getState().setSelectedReferenceId(null)
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
      } else if (e.key === 's' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('elements')
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('furnish')
      } else if (e.key === 'z' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('zones')
      }
      if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setMode('select')
      } else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setMode('build')
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        useScene.temporal.getState().undo()
      } else if (e.key === 'Z' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        useScene.temporal.getState().redo()
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
      } else if (e.key === 'r' || e.key === 'R') {
        // Rotate selected node if it supports rotation (items, roofs, etc.)
        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
        if (selectedNodeIds.length === 1) {
          const node = useScene.getState().nodes[selectedNodeIds[0]!]
          if (node && 'rotation' in node) {
            e.preventDefault()
            const ROTATION_STEP = Math.PI / 4
            let newRotationY = 0

            // Handle different rotation types (number for roof, array for items/windows/doors)
            if (typeof node.rotation === 'number') {
              newRotationY = node.rotation + ROTATION_STEP
              useScene.getState().updateNode(node.id, { rotation: newRotationY })
            } else if (Array.isArray(node.rotation)) {
              newRotationY = node.rotation[1] + ROTATION_STEP
              useScene.getState().updateNode(node.id, {
                rotation: [node.rotation[0], newRotationY, node.rotation[2]],
              })
            }
            sfxEmitter.emit('sfx:item-rotate') // Play a sound for feedback
          }
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()

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
  }, [])

  return null
}
