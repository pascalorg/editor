import type { SurfaceRejectReason } from '@pascal-app/core'

export function createSurfaceRejectionFeedback(
  onChange?: (reason: SurfaceRejectReason | null) => void,
) {
  let reason: SurfaceRejectReason | null = null
  let rejectedEvent: object | undefined
  const set = (next: SurfaceRejectReason | null) => {
    reason = next
    onChange?.(next)
  }
  return {
    get reason() {
      return reason
    },
    reject(next: SurfaceRejectReason, event?: object) {
      if (event) rejectedEvent = event
      set(next)
    },
    clear() {
      rejectedEvent = undefined
      set(null)
    },
    grid(event: object) {
      // A host refusal and the floor ray beneath it belong to the same pointer move.
      if (event !== rejectedEvent) this.clear()
    },
  }
}
