import { type AnyNodeId, emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'

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

        // If in build mode, switch back to select mode
        const { mode } = useEditor.getState()
        if (mode === 'build') {
          useEditor.getState().setMode('select')
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
