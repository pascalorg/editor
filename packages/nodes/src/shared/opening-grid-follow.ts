export function shouldFollowOpeningGrid(args: {
  eventTime: number
  hasActiveHost: boolean
  lastHostEventTime: number
  pointerType?: string
}): boolean {
  if (args.pointerType === 'xr' && args.hasActiveHost) return false
  return args.eventTime !== args.lastHostEventTime
}

export function shouldHandleOpeningHostLeave(nativeEvent: unknown): boolean {
  if (!nativeEvent || typeof nativeEvent !== 'object') return true
  const event = nativeEvent as {
    inputSource?: object
    openingHoverBridge?: boolean
    pointerState?: { inputSource?: object }
  }
  const isSpatialPointer = event.inputSource != null || event.pointerState?.inputSource != null
  return !isSpatialPointer || event.openingHoverBridge === true
}
