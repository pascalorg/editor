export let boxSelectHandled = false

let resetTimeout: ReturnType<typeof setTimeout> | null = null
const suppressedPointerIds = new Set<number>()
const suppressionCleanups = new Map<number, () => void>()

type PointerEventLike = {
  pointerId?: number
  nativeEvent?: PointerEvent | PointerEventLike
}

type SuppressBoxSelectOptions = {
  markHandled?: boolean
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

export function suppressBoxSelectForPointer(
  event: PointerEvent | PointerEventLike,
  options: SuppressBoxSelectOptions = {},
) {
  const markHandled = options.markHandled ?? true
  if (markHandled) markBoxSelectHandled()

  const pointerId = pointerIdFor(event)
  if (pointerId === null || suppressedPointerIds.has(pointerId)) return

  suppressedPointerIds.add(pointerId)

  const clear = (releaseEvent?: PointerEvent) => {
    if (releaseEvent && releaseEvent.pointerId !== pointerId) return
    if (markHandled) markBoxSelectHandled()
    suppressedPointerIds.delete(pointerId)
    const cleanup = suppressionCleanups.get(pointerId)
    suppressionCleanups.delete(pointerId)
    cleanup?.()
  }

  const onPointerUp = (releaseEvent: PointerEvent) => clear(releaseEvent)
  const onPointerCancel = (releaseEvent: PointerEvent) => clear(releaseEvent)
  const onBlur = () => clear()
  // Click-preserving handle interactions need suppression cleared before
  // canvas-level pointerup handlers decide whether to block the follow-up click.
  const releaseListenerOptions = markHandled ? undefined : { capture: true }
  const cleanup = () => {
    window.removeEventListener('pointerup', onPointerUp, releaseListenerOptions)
    window.removeEventListener('pointercancel', onPointerCancel, releaseListenerOptions)
    window.removeEventListener('blur', onBlur)
  }

  suppressionCleanups.set(pointerId, cleanup)
  window.addEventListener('pointerup', onPointerUp, releaseListenerOptions)
  window.addEventListener('pointercancel', onPointerCancel, releaseListenerOptions)
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
