// Ephemeral store for the in-progress curved-fence draft. Written by the 3D
// spline tool and read by the contextual helper plus hosted collaboration
// bridge. Reset on commit, cancel, and unmount — never persisted or recorded
// in undo history.

import { create } from 'zustand'

export type FenceCurveDraftPoint = [number, number]

type FenceCurveDraftState = {
  pointCount: number
  points: FenceCurveDraftPoint[]
  cursor: FenceCurveDraftPoint | null
  setDraft(points: readonly FenceCurveDraftPoint[], cursor: FenceCurveDraftPoint | null): void
  reset(): void
}

function pointsEqual(a: readonly FenceCurveDraftPoint[], b: readonly FenceCurveDraftPoint[]) {
  return (
    a.length === b.length &&
    a.every((point, index) => point[0] === b[index]?.[0] && point[1] === b[index]?.[1])
  )
}

const useFenceCurveDraft = create<FenceCurveDraftState>((set) => ({
  pointCount: 0,
  points: [],
  cursor: null,
  setDraft: (points, cursor) =>
    set((state) => {
      const sameCursor =
        (!cursor && !state.cursor) ||
        Boolean(
          cursor && state.cursor && state.cursor[0] === cursor[0] && state.cursor[1] === cursor[1],
        )
      if (sameCursor && pointsEqual(state.points, points)) return state
      return {
        pointCount: points.length,
        points: points.map(([x, z]) => [x, z] as FenceCurveDraftPoint),
        cursor: cursor ? [cursor[0], cursor[1]] : null,
      }
    }),
  reset: () =>
    set((state) =>
      state.pointCount === 0 && state.points.length === 0 && state.cursor === null
        ? state
        : { pointCount: 0, points: [], cursor: null },
    ),
}))

export default useFenceCurveDraft
