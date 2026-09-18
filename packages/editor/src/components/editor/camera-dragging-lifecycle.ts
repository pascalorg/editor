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
  let paused = false
  let releaseTimer: TimerHandle | null = null

  const clearScheduledEnd = () => {
    if (releaseTimer === null) return
    cancel(releaseTimer)
    releaseTimer = null
  }

  const begin = () => {
    clearScheduledEnd()
    if (!paused) setDragging(true)
  }

  const end = () => {
    clearScheduledEnd()
    setDragging(false)
  }

  const scheduleEnd = () => {
    clearScheduledEnd()
    if (paused) return
    releaseTimer = schedule(() => {
      releaseTimer = null
      setDragging(false)
    }, fallbackMs)
  }

  const setPaused = (value: boolean) => {
    paused = value
    // Paused controls cannot advance damping to rest/sleep.
    if (paused) end()
  }

  return { begin, end, scheduleEnd, setPaused }
}
