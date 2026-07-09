// Ephemeral placement option for the cabinet tool. Shared between the
// contextual helper chip and the kind-owned cabinet tool so "I" and click
// toggles always show and mutate the same current value.

import { create } from 'zustand'

export type CabinetPlacementType = 'cabinet' | 'island'

type CabinetPlacementTypeState = {
  type: CabinetPlacementType
  setType(type: CabinetPlacementType): void
  cycleType(): CabinetPlacementType
}

const nextCabinetPlacementType = (type: CabinetPlacementType): CabinetPlacementType =>
  type === 'cabinet' ? 'island' : 'cabinet'

const useCabinetPlacementType = create<CabinetPlacementTypeState>((set, get) => ({
  type: 'cabinet',
  setType: (type) => set({ type }),
  cycleType: () => {
    const next = nextCabinetPlacementType(get().type)
    set({ type: next })
    return next
  },
}))

export default useCabinetPlacementType
