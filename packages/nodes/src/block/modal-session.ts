import { useViewer } from '@pascal-app/viewer'
import type { MutableRefObject } from 'react'

type FinishModal = (commit: boolean) => void

export type BlockModalSessionOptions = {
  cancelRef: MutableRefObject<(() => void) | null>
  cursor: string
  onFinish: (commit: boolean) => void
  onKeyDown?: (event: KeyboardEvent, finish: FinishModal) => void
  onPointerDown?: (event: PointerEvent, finish: FinishModal) => void
  onPointerMove?: (event: PointerEvent) => void
}

export function beginBlockModalSession({
  cancelRef,
  cursor,
  onFinish,
  onKeyDown,
  onPointerDown,
  onPointerMove,
}: BlockModalSessionOptions): FinishModal {
  const previousInputDragging = useViewer.getState().inputDragging
  const previousCursor = document.body.style.cursor
  let finished = false

  const onContextMenu = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onCancel = () => finish(false)
  const pointerDown = (event: PointerEvent) => onPointerDown?.(event, finish)
  const keyDown = (event: KeyboardEvent) => onKeyDown?.(event, finish)

  function finish(commit: boolean) {
    if (finished) return
    finished = true
    if (onPointerMove) window.removeEventListener('pointermove', onPointerMove, true)
    if (onPointerDown) window.removeEventListener('pointerdown', pointerDown, true)
    if (onKeyDown) window.removeEventListener('keydown', keyDown, true)
    window.removeEventListener('contextmenu', onContextMenu, true)
    window.removeEventListener('blur', onCancel)
    cancelRef.current = null
    useViewer.getState().setInputDragging(previousInputDragging)
    document.body.style.cursor = previousCursor
    onFinish(commit)
  }

  useViewer.getState().setInputDragging(true)
  document.body.style.cursor = cursor
  cancelRef.current = onCancel
  if (onPointerMove) window.addEventListener('pointermove', onPointerMove, true)
  if (onPointerDown) window.addEventListener('pointerdown', pointerDown, true)
  if (onKeyDown) window.addEventListener('keydown', keyDown, true)
  window.addEventListener('contextmenu', onContextMenu, true)
  window.addEventListener('blur', onCancel, { once: true })
  return finish
}
