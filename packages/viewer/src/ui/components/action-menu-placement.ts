import { createContext, useContext } from 'react'

/** Viewport edge the action menu docks to. */
export type ActionMenuPlacement = 'bottom' | 'top'

const ActionMenuPlacementContext = createContext<ActionMenuPlacement>('bottom')

export const ActionMenuPlacementProvider = ActionMenuPlacementContext.Provider

export function useActionMenuPlacement(): ActionMenuPlacement {
  return useContext(ActionMenuPlacementContext)
}

/** Side tooltips and popovers open toward, away from the docked edge. */
export function useActionMenuPopupSide(): 'top' | 'bottom' {
  return useActionMenuPlacement() === 'top' ? 'bottom' : 'top'
}
