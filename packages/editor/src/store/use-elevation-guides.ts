import { create } from 'zustand'

export type ElevationGuide3D = {
  ownerId: string
  levelId: string
  center: readonly [number, number]
  direction: readonly [number, number]
  elevation: number
  label: string
}

type ElevationGuidesState = {
  guide: ElevationGuide3D | null
  publish(guide: ElevationGuide3D): void
  clear(ownerId: string): void
}

const useElevationGuides = create<ElevationGuidesState>((set) => ({
  guide: null,
  publish: (guide) =>
    set((state) => {
      const current = state.guide
      if (
        current?.ownerId === guide.ownerId &&
        current.levelId === guide.levelId &&
        current.elevation === guide.elevation &&
        current.label === guide.label &&
        current.center[0] === guide.center[0] &&
        current.center[1] === guide.center[1] &&
        current.direction[0] === guide.direction[0] &&
        current.direction[1] === guide.direction[1]
      ) {
        return state
      }
      return { guide }
    }),
  clear: (ownerId) => set((state) => (state.guide?.ownerId === ownerId ? { guide: null } : state)),
}))

export default useElevationGuides
