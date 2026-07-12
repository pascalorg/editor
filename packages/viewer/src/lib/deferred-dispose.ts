import type { BufferGeometry } from 'three'

/**
 * WebGPU dispose-race mitigation.
 *
 * Disposing a `BufferGeometry` that is *still referenced by a live, rendered
 * mesh* synchronously inside a `useFrame` rebuild loop is unsafe on the
 * WebGPU backend. Three's WebGPU renderer keeps a `RenderObject` that holds
 * the geometry's attributes; `BufferGeometry.dispose()` synchronously fires
 * the `dispose` event, and the renderer's handler later reads `.id` / `.count`
 * off attributes that have already been freed by the time the render pass
 * unwinds — throwing `Cannot read properties of undefined (reading 'id')`
 * (Sentry MONOREPO-EDITOR-DK / EG / EH).
 *
 * The renderer releases its `RenderObject` for a geometry once that geometry
 * is no longer drawn (i.e. after the frame in which we swapped in the new
 * geometry). So instead of disposing the *outgoing* live geometry mid-frame,
 * we hand it to this queue and flush it at the START of the next frame, after
 * the render pass that dropped it has completed. Behavior is identical —
 * every geometry is still freed, just one frame later, after the renderer has
 * let go of it.
 *
 * This is deliberately module-global (not per-system): every geometry system
 * shares one flush point, and the queue is drained wholesale each frame. Only
 * use `queueGeometryDispose` for geometries that were attached to a *rendered*
 * mesh. Transient CSG intermediates that never entered the scene graph should
 * still be disposed synchronously — the renderer never held a RenderObject for
 * them, so there is no race.
 */
const pendingGeometryDisposals = new Set<BufferGeometry>()

/**
 * Queue a live geometry for disposal after the current render. Safe to call
 * with the same geometry more than once (Set-deduped). The mesh should already
 * have been detached / reassigned to a fresh geometry before calling this.
 */
export function queueGeometryDispose(geometry: BufferGeometry | null | undefined): void {
  if (!geometry) return
  if (typeof (geometry as { dispose?: () => void }).dispose !== 'function') return
  pendingGeometryDisposals.add(geometry)
}

/**
 * Dispose everything queued since the last flush. Called once per frame by
 * `GeometryDisposalFlushSystem` at a negative `useFrame` priority, before any
 * rebuild system runs, so the renderer has had a full frame to release the
 * outgoing geometries' RenderObjects. Do not call this from a rebuild
 * system's `useFrame` — doing so risks disposing geometries queued by another
 * system in the same frame, before the render pass.
 */
export function flushGeometryDisposals(): void {
  if (pendingGeometryDisposals.size === 0) return
  for (const geometry of pendingGeometryDisposals) {
    try {
      geometry.dispose()
    } catch {
      // A geometry may already be torn down (scene unload, HMR); freeing it
      // twice is harmless and must never break the frame loop.
    }
  }
  pendingGeometryDisposals.clear()
}
