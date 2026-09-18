'use client'

import { useEffect, useRef } from 'react'

/**
 * Claims Cmd/Ctrl+S for the app's save.
 *
 * Capture phase and ungated on purpose: the browser's "Save page" dialog must
 * never appear anywhere in the editor — including first-person, studio mode and
 * while focus sits in an input, where people still expect the chord to save.
 * `e.code` keeps it on the physical S key across keyboard layouts.
 */
export function useSaveShortcut(onSave: () => void) {
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.code !== 'KeyS') return

      e.preventDefault()
      e.stopPropagation()
      onSaveRef.current()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])
}
