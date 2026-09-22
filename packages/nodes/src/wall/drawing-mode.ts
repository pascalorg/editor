import { emitter } from '@pascal-app/core'
import { isEditableKeyboardTarget } from '@pascal-app/editor'
import { useEffect } from 'react'
import { create } from 'zustand'

export const useWallDrawingMode = create<{
  mode: 'line' | 'rectangle'
  toggle: () => void
}>((set, get) => ({
  mode: 'line',
  toggle: () => {
    emitter.emit('tool:cancel')
    set({ mode: get().mode === 'rectangle' ? 'line' : 'rectangle' })
  },
}))

const onKeyDown = (e: KeyboardEvent) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key !== 'r' && e.key !== 'R') return
  if (isEditableKeyboardTarget(e.target)) return
  e.preventDefault()
  useWallDrawingMode.getState().toggle()
}
let owners = 0

/**
 * R toggles line / rectangle drawing (the HUD's Shape chip cycles the same
 * store). Both wall tools mount this: the 3D tool only exists once the canvas
 * does, and split view mounts both, so one listener serves whichever is up and
 * the mode returns to line when the last one closes.
 */
export function useWallDrawingModeKeys() {
  useEffect(() => {
    if (owners++ === 0) window.addEventListener('keydown', onKeyDown)
    return () => {
      if (--owners === 0) {
        window.removeEventListener('keydown', onKeyDown)
        useWallDrawingMode.setState({ mode: 'line' })
      }
    }
  }, [])
}
