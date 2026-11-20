export type TapOptions = { maxTravelPx?: number; maxDurationMs?: number }

type PointerSample = {
  pointerId: number
  button: number
  clientX: number
  clientY: number
  timeStamp: number
  isPrimary?: boolean
}

type Gesture = {
  down: PointerSample
  maxTravel: number
  cancelled: boolean
}

/** The maximum excursion, rather than final displacement, distinguishes a tap from a drag. */
export function isTap(gesture: Gesture, up: PointerSample, options: TapOptions): boolean {
  return (
    !gesture.cancelled &&
    gesture.down.button === 0 &&
    up.button === 0 &&
    gesture.down.isPrimary !== false &&
    up.isPrimary !== false &&
    gesture.down.pointerId === up.pointerId &&
    Math.max(
      gesture.maxTravel,
      Math.hypot(up.clientX - gesture.down.clientX, up.clientY - gesture.down.clientY),
    ) < (options.maxTravelPx ?? 7) &&
    (options.maxDurationMs === undefined ||
      up.timeStamp - gesture.down.timeStamp <= options.maxDurationMs)
  )
}

export function createPointerGestureTracker(options: TapOptions) {
  let gesture: Gesture | undefined
  let result = false
  const pointers = new Set<number>()
  return {
    down(event: PointerSample) {
      pointers.add(event.pointerId)
      result = false
      if (pointers.size > 1) {
        if (gesture) gesture.cancelled = true
        return
      }
      gesture = { down: event, maxTravel: 0, cancelled: event.isPrimary === false }
    },
    move(event: PointerSample) {
      if (!gesture || gesture.down.pointerId !== event.pointerId) return
      gesture.maxTravel = Math.max(
        gesture.maxTravel,
        Math.hypot(event.clientX - gesture.down.clientX, event.clientY - gesture.down.clientY),
      )
    },
    up(event: PointerSample) {
      result = !!gesture && isTap(gesture, event, options)
      pointers.delete(event.pointerId)
      gesture = undefined
    },
    cancel() {
      if (gesture) gesture.cancelled = true
      result = false
      pointers.clear()
    },
    // Kept until the next down so both pointer-up synthesis and the later DOM click agree.
    allowsClick() {
      return result
    },
  }
}

let active: ReturnType<typeof createPointerGestureTracker> | undefined

/** Undefined means the host has opted into the legacy dispatch rules. */
export function tapAllowsClick(): boolean | undefined {
  return active?.allowsClick()
}

export function selectionClickAllowed(cameraDragging: boolean, inputDragging: boolean): boolean {
  return !inputDragging && (tapAllowsClick() ?? !cameraDragging)
}

/** Capture precedes both R3F pointer-up synthesis and camera-controls' pointer handlers. */
export function trackPointerGestures(canvas: HTMLElement, options: TapOptions): () => void {
  const tracker = createPointerGestureTracker(options)
  active = tracker
  const win = canvas.ownerDocument.defaultView!
  const doc = canvas.ownerDocument
  const down = (event: PointerEvent) => {
    if (event.target === canvas || canvas.contains(event.target as Node)) tracker.down(event)
    else tracker.cancel()
  }
  const move = (event: PointerEvent) => tracker.move(event)
  const up = (event: PointerEvent) => tracker.up(event)
  const cancel = () => tracker.cancel()
  const visibility = () => {
    if (doc.hidden) cancel()
  }
  win.addEventListener('pointerdown', down, true)
  win.addEventListener('pointermove', move, true)
  win.addEventListener('pointerup', up, true)
  win.addEventListener('pointercancel', cancel, true)
  win.addEventListener('blur', cancel)
  doc.addEventListener('visibilitychange', visibility)
  return () => {
    win.removeEventListener('pointerdown', down, true)
    win.removeEventListener('pointermove', move, true)
    win.removeEventListener('pointerup', up, true)
    win.removeEventListener('pointercancel', cancel, true)
    win.removeEventListener('blur', cancel)
    doc.removeEventListener('visibilitychange', visibility)
    if (active === tracker) active = undefined
  }
}
