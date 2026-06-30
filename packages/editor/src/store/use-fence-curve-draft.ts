// Ephemeral store: how many points the in-progress curved-fence draft has
// placed. Written by the 3D spline draft tool (`@pascal-app/nodes`
// fence/tool.tsx) and read by the contextual helper so the "finish curve" hint
// only surfaces once the user has actually started drawing. Reset on commit,
// cancel, and unmount — never persisted, never in undo history.

import { create } from 'zustand'

type FenceCurveDraftState = {
  pointCount: number
  setPointCount(count: number): void
  reset(): void
}

const useFenceCurveDraft = create<FenceCurveDraftState>((set) => ({
  pointCount: 0,
  setPointCount: (count) => set({ pointCount: count }),
  reset: () => set({ pointCount: 0 }),
}))

export default useFenceCurveDraft
