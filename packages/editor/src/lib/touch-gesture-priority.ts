import type { Mode } from '../store/use-editor'
import { isBrushMode } from '../store/use-editor'

/**
 * Whether the editor — rather than the camera — owns a one-finger touch drag.
 *
 * On touch there is exactly one pointer, so the camera and the editor cannot both
 * have it: `custom-camera-controls` maps one finger to `TOUCH_ROTATE` by default
 * (orbiting a phone with one thumb is the common case) and to `NONE` while an
 * editor gesture is live, which lets the tool's own pointer handlers through.
 * Two fingers always pinch and three always orbit, so the camera is never
 * unreachable — that is what makes yielding one finger safe.
 *
 * Extracted from the component because the terms are not obviously exhaustive and
 * one was missing. A *brush mode* owns the drag exactly the way an armed tool
 * does, but none of the other terms notice it: entering paint or sculpt **clears**
 * `tool`, and the scope it holds is `painting`/`sculpting`, not `handle-drag`. So
 * on a tablet a one-finger drag over the ground orbited the camera instead of
 * sculpting — and set `cameraDragging`, which the sculpt tool gates pointer-down
 * on, so the stroke could not start either. The brush was simply inert on touch,
 * in both brush modes.
 *
 * `activeGesture` is the OR of the transient signals the component already reads
 * (an armed tool, a moving node, an endpoint reshape, a handle drag, marquee
 * box-select); they stay in the component because each is its own subscription,
 * while what is worth pinning down here is that a sustained *mode* counts too.
 */
export function editorOwnsOneFingerDrag(args: { mode: Mode; activeGesture: boolean }): boolean {
  return args.activeGesture || isBrushMode(args.mode)
}
