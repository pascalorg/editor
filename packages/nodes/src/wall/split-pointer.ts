import { commitWallSplit, hoverWallSplit, setWallSplitCuts } from './split-session'
import { useWallSplit } from './split-store'

// Pixels of wheel travel per cut: one mouse notch, or a short trackpad swipe.
const WHEEL_STEP_PX = 60
const WHEEL_LINE_PX = 33

/** Both viewports feed a wall distance; neither writes scene nodes while hovering. */
export function bindWallSplitPointer(
  surface: Element,
  distanceAt: (event: PointerEvent) => number | null,
) {
  let pressed: number | null = null
  let wheelTravel = 0
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
    wheelTravel += event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_PX : event.deltaY
    const steps = Math.trunc(wheelTravel / WHEEL_STEP_PX)
    if (!steps) return
    wheelTravel -= steps * WHEEL_STEP_PX
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
