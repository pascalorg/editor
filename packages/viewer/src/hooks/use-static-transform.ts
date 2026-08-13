import { type RefObject, useLayoutEffect } from 'react'
import type { Object3D } from 'three'
import { freezeObjectTransform, thawObjectTransform } from '../lib/static-transform'

/**
 * Freezes the referenced object's local matrix while it is not being moved
 * live, and re-stamps it whenever the committed transform changes.
 *
 * `live` must be true whenever some other party writes the transform outside
 * React's commit (drag tools publishing to the live stores) — the object then
 * recomputes per frame like any Three object. When `live` drops back to
 * false the effect stamps the final transform once and freezes again.
 *
 * `position` / `rotation` are dependency tokens, not inputs: pass the same
 * values the JSX props receive, so a committed move (undo, patch, snap)
 * re-runs the effect *after* R3F has applied the new props, and the stamp
 * picks them up. Stamping order inside `freezeObjectTransform` is the trap
 * this hook exists to centralise — see `lib/static-transform.ts`.
 */
export function useStaticTransform(
  ref: RefObject<Object3D | null>,
  live: boolean,
  position: unknown,
  rotation: unknown,
) {
  useLayoutEffect(() => {
    const object = ref.current
    if (!object) return
    if (live) {
      thawObjectTransform(object)
      return
    }
    freezeObjectTransform(object)
    return () => thawObjectTransform(object)
  }, [ref, live, position, rotation])
}
