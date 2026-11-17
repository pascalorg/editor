/** Standing movement in metres per second; crouch retains its own speeds. */
export type WalkthroughSpeeds = { walk?: number; run?: number }
export const WALKTHROUGH_DEFAULT_SPEEDS = { walk: 2, run: 5 } as const
/** How far the centre ray identifies an interactable; activation keeps its existing reach. */
export const WALKTHROUGH_SEE_DISTANCE = 16

// The baked controller and GlbScene are siblings sharing the package's one active scene.
// GlbScene owns interaction; the controller owns session options and restores them on exit.
export const bakedWalkthroughSettings = { seeDistance: WALKTHROUGH_SEE_DISTANCE }
