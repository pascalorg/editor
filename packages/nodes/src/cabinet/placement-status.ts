import { create } from 'zustand'

type CabinetPlacementStatusState = {
  blocked: boolean
  setBlocked(blocked: boolean): void
}

const useCabinetPlacementStatus = create<CabinetPlacementStatusState>((set) => ({
  blocked: false,
  setBlocked: (blocked) => set({ blocked }),
}))

export default useCabinetPlacementStatus
