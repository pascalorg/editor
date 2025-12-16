'use client'

import { useEffect } from 'react'
import { emitter } from '@/events/bus'
import { useEditor } from './use-editor'

export function useKeyboard() {
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const handleDeleteSelected = useEditor((state) => state.handleDeleteSelected)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const setControlMode = useEditor((state) => state.setControlMode)
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const groupSelected = useEditor((state) => state.groupSelected)
  const ungroupSelected = useEditor((state) => state.ungroupSelected)
  const handleClear = useEditor((state) => state.handleClear)

  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        // Emit tool:cancel event - each tool handles its own cancellation logic
        if (useEditor.getState().controlMode === 'building') {
          emitter.emit('tool:cancel', undefined)
        }
        if (selectedNodeIds.length > 0) {
          handleClear()
        }
      } else if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('select')
      } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('edit')
      } else if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('delete')
      } else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        // Restore the last used building tool
        setActiveTool(useEditor.getState().lastBuildingTool)
      } else if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('guide')
      } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('painting')
      } else if ((e.key === 'g' || e.key === 'G') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (e.shiftKey) {
          ungroupSelected()
        } else {
          groupSelected()
        }
      } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
      } else if (e.key === 'l' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        toggleLevelMode()
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        undo()
      } else if (e.key === 'Z' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selectedNodeIds.length > 0) {
          handleDeleteSelected()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    undo,
    redo,
    setControlMode,
    setActiveTool,
    cameraMode,
    setCameraMode,
    selectedNodeIds,
    handleDeleteSelected,
    toggleLevelMode,
    groupSelected,
    ungroupSelected,
    handleClear,
  ])
}
