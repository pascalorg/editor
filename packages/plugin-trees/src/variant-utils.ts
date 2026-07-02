import { Box3, type Object3D } from 'three'

// Pure helpers shared by the tree/flower/grass variant builders. They live
// apart from `geometry.ts` because that module imports ez-tree, which loads
// its inlined textures at module scope (needs `document`) and therefore must
// never sit on an eagerly-imported path (index → definitions → floorplan) —
// SSR/prerender would crash. Only lazy client modules may import `geometry.ts`.

/** Natural (unscaled) height of a generated plant, so the renderer can scale
 * each instance to the node's `height`. */
export function naturalHeight(obj: Object3D): number {
  const box = new Box3().setFromObject(obj)
  return Math.max(0.001, box.max.y - box.min.y)
}

/** Deterministic 32-bit RNG (mulberry32) — same seed ⇒ same geometry. Shared by
 * the procedural flower/grass builders so a variant is stable across instances. */
export function mulberry32(seed: number): () => number {
  let a = seed || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
