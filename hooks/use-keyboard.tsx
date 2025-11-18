'use client'

import { useEffect } from 'react'
import { useEditor } from './use-editor'

export function useKeyboard() {
  const selectedElements = useEditor((state) => state.selectedElements)
  const selectedImageIds = useEditor((state) => state.selectedImageIds)
  const selectedScanIds = useEditor((state) => state.selectedScanIds)
  const handleDeleteSelectedElements = useEditor((state) => state.handleDeleteSelectedElements)
  const handleDeleteSelectedImages = useEditor((state) => state.handleDeleteSelectedImages)
  const handleDeleteSelectedScans = useEditor((state) => state.handleDeleteSelectedScans)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const activeTool = useEditor((state) => state.activeTool)
  const setControlMode = useEditor((state) => state.setControlMode)
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)

  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        setControlMode('select')
      } else if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('select')
      } else if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('delete')
      } else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        // Default to 'wall' tool if no active tool when entering building mode
        if (activeTool) {
          setControlMode('building')
        } else {
          setActiveTool('wall')
        }
      } else if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('guide')
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
        if (selectedElements.length > 0) {
          handleDeleteSelectedElements()
        } else if (selectedImageIds.length > 0) {
          // Handle image deletion separately (not building elements)
          handleDeleteSelectedImages()
        } else if (selectedScanIds.length > 0) {
          // Handle scan deletion separately
          handleDeleteSelectedScans()
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
    activeTool,
    cameraMode,
    setCameraMode,
    selectedElements,
    selectedImageIds,
    selectedScanIds,
    handleDeleteSelectedElements,
    handleDeleteSelectedImages,
    handleDeleteSelectedScans,
    toggleLevelMode,
  ])
}
