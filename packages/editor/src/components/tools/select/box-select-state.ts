export let boxSelectHandled = false

let resetTimeout: ReturnType<typeof setTimeout> | null = null
const suppressedPointerIds = new Set<number>()
const suppressionCleanups = new Map<number, () => void>()

type PointerEventLike = {
  pointerId?: number
  nativeEvent?: PointerEvent | PointerEventLike
}

function pointerIdFor(event: PointerEvent | PointerEventLike): number | null {
  if ('pointerId' in event && typeof event.pointerId === 'number') {
    return event.pointerId
  }
  const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : undefined
  return nativeEvent ? pointerIdFor(nativeEvent) : null
}

export function markBoxSelectHandled() {
  boxSelectHandled = true
  if (resetTimeout) {
    clearTimeout(resetTimeout)
  }
  resetTimeout = setTimeout(() => {
    boxSelectHandled = false
    resetTimeout = null
  }, 50)
}

export function suppressBoxSelectForPointer(event: PointerEvent | PointerEventLike) {
  markBoxSelectHandled()

  const pointerId = pointerIdFor(event)
  if (pointerId === null || suppressedPointerIds.has(pointerId)) return

  suppressedPointerIds.add(pointerId)

  const clear = (releaseEvent?: PointerEvent) => {
    if (releaseEvent && releaseEvent.pointerId !== pointerId) return
    markBoxSelectHandled()
    suppressedPointerIds.delete(pointerId)
    const cleanup = suppressionCleanups.get(pointerId)
    suppressionCleanups.delete(pointerId)
    cleanup?.()
  }

  const onPointerUp = (releaseEvent: PointerEvent) => clear(releaseEvent)
  const onPointerCancel = (releaseEvent: PointerEvent) => clear(releaseEvent)
  const onBlur = () => clear()
  const cleanup = () => {
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('blur', onBlur)
  }

  suppressionCleanups.set(pointerId, cleanup)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('blur', onBlur)
}

export function isBoxSelectPointerSuppressed(event: PointerEvent | PointerEventLike) {
  const pointerId = pointerIdFor(event)
  return pointerId !== null && suppressedPointerIds.has(pointerId)
}

export function clearBoxSelectHandled() {
  if (resetTimeout) {
    clearTimeout(resetTimeout)
    resetTimeout = null
  }
  boxSelectHandled = false
  for (const cleanup of suppressionCleanups.values()) cleanup()
  suppressionCleanups.clear()
  suppressedPointerIds.clear()
}
