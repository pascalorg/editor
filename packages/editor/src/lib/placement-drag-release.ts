'use client'

import useEditor from '../store/use-editor'

function swallowNextClick(timeoutMs = 300) {
  const swallow = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
  }

  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), timeoutMs)
}

export function consumePlacementDragRelease(event: PointerEvent): boolean {
  if (!useEditor.getState().placementDragMode) return false
  if (event.button !== 0) return false

  event.stopPropagation()
  event.preventDefault()
  swallowNextClick()
  return true
}
