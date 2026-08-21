export const BLOCK_WHEEL_OPTIONS = { capture: true, passive: false } as const

type BlockGestureWheelEvent = Pick<
  WheelEvent,
  'deltaY' | 'preventDefault' | 'stopImmediatePropagation' | 'stopPropagation'
>

export function consumeBlockGestureWheel(event: BlockGestureWheelEvent): -1 | 0 | 1 {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0
}
