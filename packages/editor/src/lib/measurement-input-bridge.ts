import { emitter, type GridEvent } from '@pascal-app/core'
import useMeasurementInput from '../store/use-measurement-input'

/**
 * Makes a typed dimension behave like a pointer move.
 *
 * Drafting tools resolve their draft inside a `grid:move` handler, so a value
 * typed while the mouse is still would not show up until the user jiggled the
 * pointer. Rather than teaching every tool to subscribe to the buffer, this
 * records the last grid event and replays it whenever the typed value changes —
 * so every tool that already listens to `grid:move` tracks what is typed, with
 * no per-kind wiring. `tool:commit` (Enter) replays it as a `grid:click`, which
 * is exactly the event a real click would have delivered.
 *
 * Returns its own disposer; `useMeasurementInputBridge` mounts it once.
 */
export function createMeasurementInputBridge(): () => void {
  let lastGridEvent: GridEvent | null = null

  const rememberGridEvent = (event: GridEvent) => {
    lastGridEvent = event
  }

  // Only the text matters: a field change without new text (or the clear that
  // follows every interaction) must not fabricate pointer activity.
  const unsubscribe = useMeasurementInput.subscribe((state, previous) => {
    if (state.buffer === previous.buffer) return
    if (lastGridEvent) emitter.emit('grid:move', lastGridEvent)
  })

  const commitAtTypedValue = () => {
    if (lastGridEvent) emitter.emit('grid:click', lastGridEvent)
  }

  // A committed point consumes the typed value. Without this a chained draft
  // would force every following segment to the same length, since the scope
  // stays `drafting` between segments and the store's idle-clear never fires.
  // Deferred so it lands after the tool's own click handler has read it — this
  // covers a click commit and the Enter path above alike.
  const clearConsumedValue = () => {
    if (useMeasurementInput.getState().buffer === '') return
    queueMicrotask(() => useMeasurementInput.getState().clear())
  }

  emitter.on('grid:move', rememberGridEvent)
  emitter.on('grid:click', clearConsumedValue)
  emitter.on('tool:commit', commitAtTypedValue)

  return () => {
    emitter.off('grid:move', rememberGridEvent)
    emitter.off('grid:click', clearConsumedValue)
    emitter.off('tool:commit', commitAtTypedValue)
    unsubscribe()
  }
}
