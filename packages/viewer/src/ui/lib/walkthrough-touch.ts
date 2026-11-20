import { createWalkthroughInput } from '../../lib/walkthrough-input'
import useViewer from '../../store/use-viewer'

export const STICK_RADIUS = 56

/** Screen-space displacement to camera-relative right/forward, with a radial dead zone. */
export function walkthroughStick(dx: number, dy: number, radius = STICK_RADIUS) {
  const distance = Math.hypot(dx, dy)
  const scale = distance > radius ? radius / distance : 1
  return {
    x: distance <= radius * 0.12 ? 0 : (dx * scale) / radius,
    y: distance <= radius * 0.12 ? 0 : (-dy * scale) / radius || 0,
    dx: dx * scale,
    dy: dy * scale,
  }
}

type Pointer = {
  pointerId: number
  clientX: number
  clientY: number
  preventDefault: () => void
  currentTarget: { setPointerCapture: (id: number) => void }
}
type Point = { id: number; x: number; y: number }
export type StickVisual = { x: number; y: number; dx: number; dy: number } | null

/** Pointer ownership is independent of React renders; a second thumb cannot steal the first. */
export function createWalkthroughTouchGestures(drawStick: (visual: StickVisual) => void) {
  const input = createWalkthroughInput()
  let stick: Point | null = null
  let look: Point | null = null
  const buttons = new Set<number>()
  let crouchPointer: number | null = null
  const take = (event: Pointer) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    return { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  return {
    reset() {
      stick = null
      look = null
      buttons.clear()
      crouchPointer = null
      drawStick(null)
    },
    stickDown(event: Pointer) {
      if (stick) return
      stick = take(event)
      input.setMove(0, 0)
      drawStick({ x: stick.x, y: stick.y, dx: 0, dy: 0 })
    },
    stickMove(event: Pointer) {
      if (stick?.id !== event.pointerId) return
      const value = walkthroughStick(event.clientX - stick.x, event.clientY - stick.y)
      input.setMove(value.x, value.y)
      drawStick({ x: stick.x, y: stick.y, dx: value.dx, dy: value.dy })
    },
    lookDown(event: Pointer) {
      if (!look) look = take(event)
    },
    lookMove(event: Pointer) {
      if (look?.id !== event.pointerId) return
      input.addLook(event.clientX - look.x, event.clientY - look.y)
      look.x = event.clientX
      look.y = event.clientY
    },
    buttonDown(event: Pointer) {
      if (buttons.has(event.pointerId)) return false
      take(event)
      buttons.add(event.pointerId)
      return true
    },
    crouchDown(event: Pointer) {
      if (crouchPointer !== null || buttons.has(event.pointerId)) return
      take(event)
      buttons.add(event.pointerId)
      crouchPointer = event.pointerId
      input.setCrouch(true)
    },
    up(event: Pointer) {
      if (crouchPointer === event.pointerId) {
        crouchPointer = null
        input.setCrouch(false)
      }
      if (stick?.id === event.pointerId) {
        stick = null
        input.setMove(0, 0)
        drawStick(null)
      }
      if (look?.id === event.pointerId) look = null
      buttons.delete(event.pointerId)
    },
    lost(event: Pointer) {
      // A normal pointerup already released ownership; unexpected capture loss cancels all input.
      if (
        stick?.id === event.pointerId ||
        look?.id === event.pointerId ||
        buttons.has(event.pointerId)
      ) {
        input.clear()
      }
    },
    cancel() {
      input.clear()
    },
    exit() {
      useViewer.getState().setWalkthroughMode(false)
    },
  }
}
