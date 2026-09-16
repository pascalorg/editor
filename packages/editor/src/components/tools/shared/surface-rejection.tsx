import type { SurfaceRejectReason } from '@pascal-app/core'
import { Html } from '@react-three/drei'

const messages: Record<SurfaceRejectReason, string> = {
  'footprint-outside-surface': "Doesn't fit this surface",
  'footprint-exceeds-host': "Doesn't fit this surface",
  'surface-cutout': 'Over a sink or hob cutout',
  'child-not-accepted': "This host doesn't accept this kind of object",
  'host-not-eligible': "This host doesn't accept this kind of object",
  'no-surface': 'No supporting surface here',
  'invalid-hit': 'No supporting surface here',
}

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

export function SurfaceRejectionLabel({
  reason,
  position,
}: {
  reason: SurfaceRejectReason | null
  position: [number, number, number]
}) {
  if (!reason) return null
  return (
    <Html center position={position} style={{ pointerEvents: 'none' }}>
      <span
        role="status"
        className="whitespace-nowrap rounded-full bg-zinc-900 px-2 py-1 text-xs text-red-300"
      >
        {messages[reason]}
      </span>
    </Html>
  )
}
