import { create } from 'zustand'

/** The camera actions the canvas hint can name. */
export type CameraHintAction = 'Pan' | 'Rotate' | 'Zoom'

/**
 * Which camera controls the canvas hint is currently allowed to name.
 *
 * `null` — the default — means all of them, which is what the editor shows on
 * its own: a first-time user has no idea which button does what, and the panel
 * is there to answer that once.
 *
 * A host teaching the camera one gesture at a time needs the opposite. Showing
 * three controls while asking for one turns the answer into a search, and
 * leaving all three up after the lesson leaves a permanent widget over the
 * canvas explaining something the user has just been walked through. So a host
 * can narrow the panel to the gesture it is asking for, and to nothing at all
 * once it is done — an empty list hides the panel outright.
 *
 * Deliberately a store rather than a prop: the thing that knows which gesture
 * is being taught is a host surface several levels away from the canvas, and
 * threading it through would put a teaching concern in every component between.
 * The editor knows only "show these actions"; it never learns why.
 */
type CameraHintFocus = {
  actions: readonly CameraHintAction[] | null
  focus: (actions: readonly CameraHintAction[] | null) => void
}

export const useCameraHintFocus = create<CameraHintFocus>((set) => ({
  actions: null,
  focus: (actions) =>
    set((state) => {
      const current = state.actions
      if (
        current === actions ||
        (current !== null &&
          actions !== null &&
          current.length === actions.length &&
          current.every((action, index) => action === actions[index]))
      ) {
        return state
      }
      return { actions }
    }),
}))

export default useCameraHintFocus
