import { create } from 'zustand'

type CabinetPlacementStatusState = {
  blocked: boolean
  target: string | null
  setTarget(target: string | null): void
  setBlocked(blocked: boolean): void
}

const useCabinetPlacementStatus = create<CabinetPlacementStatusState>((set) => ({
  blocked: false,
  target: null,
  setTarget: (target) => set({ target }),
  setBlocked: (blocked) => set({ blocked, target: null }),
}))

export default useCabinetPlacementStatus
