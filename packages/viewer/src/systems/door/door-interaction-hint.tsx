'use client'

import useViewer from '../../store/use-viewer'

/**
 * "Press F to open / Press F to close" prompt that sits just under the
 * walkthrough crosshair whenever the user is aiming at a door within
 * reach.
 *
 * Renders as a plain DOM element with fixed positioning — intended to be
 * mounted inside a DOM overlay that already sits over the canvas (e.g.
 * the editor's `FirstPersonOverlay`), not inside the `<Canvas>` itself.
 * No-ops outside walkthrough mode or when nothing is targeted.
 */
export const DoorInteractionHint = () => {
  const hoveredDoorId = useViewer((s) => s.crosshairHoveredDoorId)
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  // Subscribe to just this door's animation entry so the verb flips the
  // frame the user presses F (subscribing to the whole `doorAnim` record
  // would re-render on every door toggle anywhere in the scene). Hook
  // runs unconditionally — the `null` branch covers the no-hover case
  // without violating rules of hooks.
  const anim = useViewer((s) => (hoveredDoorId ? s.doorAnim[hoveredDoorId] : null))

  if (!walkthroughMode || !hoveredDoorId) return null

  // Target-based verb: animations in flight still read as their final state,
  // which matches what the user's action is going to do when they press F
  // (toggle to the opposite of target).
  const verb = anim?.target === 1 ? 'close' : 'open'

  return (
    <div
      className="pointer-events-none fixed top-1/2 left-1/2 z-50 -translate-x-1/2 translate-y-8"
      style={{ userSelect: 'none' }}
    >
      <div
        className="rounded-md bg-black/60 px-3 py-1.5 font-medium text-white text-xs shadow-lg backdrop-blur-sm"
        style={{ letterSpacing: '0.02em' }}
      >
        Press <span className="mx-1 rounded bg-white/15 px-1.5 py-0.5 font-mono">F</span> to {verb}
      </div>
    </div>
  )
}
