/**
 * Node-compatibility shims for `@pascal-app/core`.
 *
 * The core store uses `requestAnimationFrame` inside `updateNodesAction` (to batch
 * dirty-marking) and inside the temporal undo/redo subscribe callback. Both are
 * load-reachable — the subscribe callback registers at module import time.
 *
 * This file installs a no-op-if-already-defined polyfill that works both in
 * Node and in the browser. It MUST be imported FIRST from any module that
 * transitively loads `@pascal-app/core/store`, otherwise the core module will
 * throw at import time.
 *
 * Side-effectful on import: there is no exported API — just import this file.
 */

type RafCallback = (timestamp: number) => void

type GlobalWithRaf = typeof globalThis & {
  requestAnimationFrame?: (cb: RafCallback) => number
  cancelAnimationFrame?: (id: number) => void
}

const g = globalThis as GlobalWithRaf

if (typeof g.requestAnimationFrame === 'undefined') {
  g.requestAnimationFrame = (cb: RafCallback): number => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    return setTimeout(() => cb(now), 0) as unknown as number
  }
  g.cancelAnimationFrame = (id: number) => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
  }
}
