import { type BufferGeometry, Mesh, type Object3D } from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

export type SceneBvhMaintainerOptions = {
  /** three-mesh-bvh build options, passed through to `computeBoundsTree`. */
  bvh?: Record<string, unknown>
  /**
   * Frames between scene scans while the build queue is empty. The scan is a
   * full traverse, so it is throttled; newly added geometry waits at most
   * this many frames before entering the queue (raycasts against it fall
   * back to plain triangle tests until then, which is correct, just slower).
   */
  scanInterval?: number
  /** Per-step build budget in milliseconds. See `step` for the guarantee. */
  budgetMs?: number
  /** Injectable clock for tests. */
  now?: () => number
}

export type SceneBvhMaintainer = {
  /**
   * One maintenance pass, meant to run every frame. Scans for new work every
   * `scanInterval` frames, then builds queued BVHs until `budgetMs` is
   * spent — but always at least one build when the queue is non-empty, so a
   * single oversized geometry cannot starve the queue forever.
   */
  step(): void
  /** Restore stock raycast functions and free every tree still in the scene. */
  dispose(): void
}

const isMesh = (object: unknown): object is Mesh =>
  !!object && typeof object === 'object' && (object as Mesh).isMesh === true

export const isSceneBvhExcluded = (object: Mesh) => object.userData.excludeFromBvh === true

const hasBvhCompatibleGeometry = (geometry?: BufferGeometry | null) => {
  if (!geometry) return false
  const position = geometry.getAttribute('position')
  if (!position) return false
  const vertexCount = geometry.getIndex()?.count ?? position.count
  return vertexCount >= 3
}

/**
 * Keeps every raycastable mesh under `root` BVH-indexed as the scene changes.
 *
 * The one-shot predecessor traversed once, on mount — when the scene was
 * still empty, because renderers populate it over the following frames — so
 * it indexed nothing, and every later geometry swap (each wall edit replaces
 * its mesh's geometry) shed whatever index existed. Result: every pointer
 * move brute-forced millions of triangles. "Run once, later" cannot fix
 * that; the scene never stops changing. This maintainer re-scans on a cheap
 * cadence and builds under a frame budget instead.
 *
 * Memory: no strong registries of meshes or geometries are kept — a swapped
 *-out geometry dies with its last reference, tree attached. `dispose`
 * frees what is still reachable from `root`; anything already detached is
 * the GC's, same as before.
 */
export function createSceneBvhMaintainer(
  root: Object3D,
  {
    bvh = {},
    scanInterval = 15,
    budgetMs = 4,
    now = () => performance.now(),
  }: SceneBvhMaintainerOptions = {},
): SceneBvhMaintainer {
  const queue: Array<{ geometry: BufferGeometry; label: string }> = []
  // Guards against re-queueing while queued, and against retrying a build
  // that threw — a geometry that failed once will fail every frame, and the
  // console.warn storm would be worse than the missing index.
  const pending = new WeakSet<BufferGeometry>()
  const failed = new WeakSet<BufferGeometry>()
  let framesSinceScan = Number.POSITIVE_INFINITY // first step always scans

  const scan = () => {
    root.traverse((child) => {
      if (!isMesh(child)) return
      if (isSceneBvhExcluded(child)) return

      if (child.raycast === Mesh.prototype.raycast) {
        child.raycast = acceleratedRaycast
      }
      if (child.raycast !== acceleratedRaycast) return

      const geometry = child.geometry
      if (geometry.boundsTree || pending.has(geometry) || failed.has(geometry)) return
      if (!hasBvhCompatibleGeometry(geometry)) return

      pending.add(geometry)
      queue.push({ geometry, label: child.name || child.type })
    })
  }

  const build = (entry: { geometry: BufferGeometry; label: string }) => {
    const { geometry } = entry
    pending.delete(geometry)
    // The scene may have moved on while this sat in the queue.
    if (geometry.boundsTree || !hasBvhCompatibleGeometry(geometry)) return
    try {
      // three-mesh-bvh's helpers vs @types/three disagree on option/class
      // identity — cast through the structural mismatch; runtime is fine.
      ;(geometry as { computeBoundsTree?: unknown }).computeBoundsTree =
        computeBoundsTree as unknown as typeof geometry.computeBoundsTree
      ;(geometry as { disposeBoundsTree?: unknown }).disposeBoundsTree =
        disposeBoundsTree as unknown as typeof geometry.disposeBoundsTree
      geometry.computeBoundsTree(bvh)
    } catch (error) {
      failed.add(geometry)
      console.warn('[viewer] Skipping BVH for incompatible mesh geometry.', {
        mesh: entry.label,
        error,
      })
    }
  }

  return {
    step() {
      framesSinceScan += 1
      if (queue.length === 0) {
        if (framesSinceScan < scanInterval) return
        framesSinceScan = 0
        scan()
      }

      const deadline = now() + budgetMs
      while (queue.length > 0) {
        const entry = queue.shift()
        if (entry) build(entry)
        if (now() >= deadline) break
      }
    },
    dispose() {
      root.traverse((child) => {
        if (!isMesh(child)) return
        if (child.raycast === acceleratedRaycast) {
          child.raycast = Mesh.prototype.raycast
        }
        const geometry = child.geometry
        if (geometry?.boundsTree) {
          // The helper is attached at build time; a tree computed by someone
          // else may not carry it. Dropping the reference is the same
          // operation — a MeshBVH holds no GPU resources.
          if (typeof geometry.disposeBoundsTree === 'function') geometry.disposeBoundsTree()
          else geometry.boundsTree = undefined
        }
      })
      queue.length = 0
    },
  }
}
