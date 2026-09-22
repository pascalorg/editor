import { commitWallSplit, hoverWallSplit, setWallSplitCuts } from './split-session'
import { useWallSplit } from './split-store'

// Pixels of continuous wheel travel per cut: a short trackpad swipe.
const WHEEL_STEP_PX = 60
// A wheel event after this pause is a new notch or gesture and steps at once,
// so each notch of a notched wheel is one cut whatever pixels the OS reports
// for it; a continuous stream (trackpad, fast spin) steps by travel.
const WHEEL_GESTURE_GAP_MS = 80

/** Both viewports feed a wall distance; neither writes scene nodes while hovering. */
export function bindWallSplitPointer(
  surface: Element,
  distanceAt: (event: PointerEvent) => number | null,
) {
  let pressed: number | null = null
  let wheelTravel = 0
  let lastWheelAt = Number.NEGATIVE_INFINITY
  const move = (event: PointerEvent) => {
    if (event.buttons && pressed !== event.pointerId) return
    const distance = distanceAt(event)
    if (distance !== null) hoverWallSplit(distance, event.altKey)
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return
    const distance = distanceAt(event)
    if (distance === null) return
    pressed = event.pointerId
    event.preventDefault()
    event.stopImmediatePropagation()
    hoverWallSplit(distance, event.altKey)
  }
  const up = (event: PointerEvent) => {
    if (pressed !== event.pointerId) return
    pressed = null
    event.preventDefault()
    event.stopImmediatePropagation()
    const distance = distanceAt(event)
    if (distance === null) return
    hoverWallSplit(distance, event.altKey)
    // Retain ownership through the click dispatched after pointerup, so normal
    // selection cannot consume that same click after the cut closes its session.
    const swallow = (click: Event) => {
      click.preventDefault()
      click.stopImmediatePropagation()
    }
    surface.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => surface.removeEventListener('click', swallow, true), 0)
    commitWallSplit()
  }
  const cancel = () => {
    pressed = null
  }
  // Scrolling over the viewport changes the cut count, as in a loop cut;
  // pinch (Ctrl + wheel) still zooms.
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || !(event.target instanceof Node) || !surface.contains(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.deltaY) return
    const fresh = event.timeStamp - lastWheelAt > WHEEL_GESTURE_GAP_MS
    lastWheelAt = event.timeStamp
    let steps: number
    // Line-mode deltas only come from a notched wheel: one line event, one notch.
    if (fresh || event.deltaMode !== 0) {
      wheelTravel = 0
      steps = Math.sign(event.deltaY)
    } else {
      wheelTravel += event.deltaY
      steps = Math.trunc(wheelTravel / WHEEL_STEP_PX)
      wheelTravel -= steps * WHEEL_STEP_PX
    }
    if (!steps) return
    const draft = useWallSplit.getState().draft
    if (draft) setWallSplitCuts(draft.cuts - steps)
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('wheel', wheel, { capture: true, passive: false })
  return () => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('wheel', wheel, true)
  }
}
