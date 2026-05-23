import { type AnyNodeId, useLiveTransforms } from '@pascal-app/core'

type LivePayload = { position: [number, number, number]; rotation: number }

const pendingByNode = new Map<string, LivePayload>()
const rafByNode = new Map<string, number>()

/** Batch live-transform writes to one React update per frame during plan drag. */
export function schedulePlanDragLiveTransform(nodeId: AnyNodeId, payload: LivePayload) {
  pendingByNode.set(nodeId, payload)
  if (rafByNode.has(nodeId)) return

  const raf = requestAnimationFrame(() => {
    rafByNode.delete(nodeId)
    const pending = pendingByNode.get(nodeId)
    pendingByNode.delete(nodeId)
    if (pending) {
      useLiveTransforms.getState().set(nodeId, pending)
    }
  })
  rafByNode.set(nodeId, raf)
}

export function clearPlanDragLiveTransform(nodeId: AnyNodeId) {
  const raf = rafByNode.get(nodeId)
  if (raf !== undefined) {
    cancelAnimationFrame(raf)
    rafByNode.delete(nodeId)
  }
  pendingByNode.delete(nodeId)
  useLiveTransforms.getState().clear(nodeId)
}
