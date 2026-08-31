type TimerHandle = ReturnType<typeof globalThis.setTimeout>

export function createCameraDraggingLifecycle({
  setDragging,
  fallbackMs = 500,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}: {
  setDragging: (dragging: boolean) => void
  fallbackMs?: number
  schedule?: (callback: () => void, delay: number) => TimerHandle
  cancel?: (timer: TimerHandle) => void
}) {
  let releaseTimer: TimerHandle | null = null

  const clearScheduledEnd = () => {
    if (releaseTimer === null) return
    cancel(releaseTimer)
    releaseTimer = null
  }

  const begin = () => {
    clearScheduledEnd()
    setDragging(true)
  }

  const end = () => {
    clearScheduledEnd()
    setDragging(false)
  }

  const scheduleEnd = () => {
    clearScheduledEnd()
    releaseTimer = schedule(() => {
      releaseTimer = null
      setDragging(false)
    }, fallbackMs)
  }

  return { begin, end, scheduleEnd }
}
