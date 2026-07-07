import { useFrame } from '@react-three/fiber'
import { flushGeometryDisposals } from '../../lib/deferred-dispose'

/**
 * Single, authoritative flush point for the deferred geometry-disposal queue
 * (Sentry MONOREPO-EDITOR-DK/EG/EH).
 *
 * Correctness depends on the flush running *before any rebuild system queues a
 * new disposal in the same frame*. If a rebuild system (GeometrySystem,
 * RoofSystem, …) both flushed and queued from its own `useFrame`, a system
 * running later in the frame could flush geometries that an earlier system had
 * just queued *this* frame — disposing them before the render pass and
 * reintroducing the very race deferral is meant to prevent.
 *
 * R3F runs `useFrame` callbacks in ascending `priority` order (ties broken by
 * mount order). Running this flush at a strongly negative priority guarantees
 * it executes ahead of every rebuild system every frame, regardless of mount
 * order, so the queue only ever contains geometries dropped on a *previous*
 * frame — which the renderer has already released. This must be the ONLY
 * caller of `flushGeometryDisposals`.
 */
const FLUSH_PRIORITY = -1000

export const GeometryDisposalFlushSystem = () => {
  useFrame(() => {
    flushGeometryDisposals()
  }, FLUSH_PRIORITY)

  return null
}
