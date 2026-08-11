export const CUSTOM_MESH_WHEEL_OPTIONS = { capture: true, passive: false } as const

type CustomMeshGestureWheelEvent = Pick<
  WheelEvent,
  'deltaY' | 'preventDefault' | 'stopImmediatePropagation' | 'stopPropagation'
>

export function consumeCustomMeshGestureWheel(event: CustomMeshGestureWheelEvent): -1 | 0 | 1 {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0
}
