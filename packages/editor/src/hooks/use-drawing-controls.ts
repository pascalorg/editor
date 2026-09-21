import { useEffect } from 'react'
import { hasDrawingControls, runDrawingControl } from '../lib/drawing-controls'
import useDeleteConfirmation from '../store/use-delete-confirmation'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'

export function useDrawingControls(disabled = false) {
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const { mode, tool, viewMode, isFirstPersonMode, workspaceMode } = useEditor.getState()
      if (
        mode !== 'build' ||
        isFirstPersonMode ||
        workspaceMode === 'studio' ||
        useDeleteConfirmation.getState().request ||
        !hasDrawingControls(tool) ||
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.key !== 'Enter' && event.key !== 'Backspace')
      )
        return
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], button, [role="button"]',
        )
      )
        return
      const scope = useInteractionScope.getState().scope
      if (
        scope.kind !== 'idle' &&
        !(scope.kind === 'drafting' && scope.tool === tool) &&
        !(scope.kind === 'placing' && scope.driver === 'registry-tool' && scope.nodeType === tool)
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat) return
      runDrawingControl(tool, event.key === 'Enter' ? 'finish' : 'back', viewMode)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [disabled])
}
