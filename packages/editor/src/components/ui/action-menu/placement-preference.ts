import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActionMenuPlacement } from './placement'

type ActionMenuPlacementPreference = {
  /** The user's own pick; null until they choose, so the host's default applies. */
  placement: ActionMenuPlacement | null
  setPlacement: (placement: ActionMenuPlacement) => void
}

export const useActionMenuPlacementPreference = create<ActionMenuPlacementPreference>()(
  persist(
    (set) => ({
      placement: null,
      setPlacement: (placement) => set({ placement }),
    }),
    { name: 'pascal-editor-action-menu-placement' },
  ),
)
