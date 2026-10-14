import { createContext, useContext } from 'react'

/** Viewport edge the action menu docks to. */
export type ActionMenuPlacement = 'bottom' | 'top' | 'left' | 'right'

/** Where chrome under a top-docked menu starts: below the host toolbar row and the menu itself. */
export const TOP_MENU_CLEARANCE = '7.25rem'

const ActionMenuPlacementContext = createContext<ActionMenuPlacement>('bottom')

export const ActionMenuPlacementProvider = ActionMenuPlacementContext.Provider

export function useActionMenuPlacement(): ActionMenuPlacement {
  return useContext(ActionMenuPlacementContext)
}

/** Side tooltips and popovers open toward, away from the docked edge. */
export function useActionMenuPopupSide(): 'top' | 'bottom' | 'left' | 'right' {
  const placement = useActionMenuPlacement()
  if (placement === 'left') return 'right'
  if (placement === 'right') return 'left'
  return placement === 'top' ? 'bottom' : 'top'
}

/** True when the menu is a vertical rail and its groups stack top to bottom. */
export function useActionMenuVertical(): boolean {
  const placement = useActionMenuPlacement()
  return placement === 'left' || placement === 'right'
}

/** Corner of a rail button that holds its split-button arrow: the side facing the viewer. */
export function useActionMenuArrowCorner(): 'left-0.5' | 'right-0.5' {
  return useActionMenuPlacement() === 'right' ? 'left-0.5' : 'right-0.5'
}

/** Rotation that points a split-button arrow toward where its popover opens. */
export function useActionMenuArrowRotation(isOpen: boolean): string | false {
  const placement = useActionMenuPlacement()
  if (placement === 'left') return '-rotate-90'
  if (placement === 'right') return 'rotate-90'
  return isOpen && 'rotate-180'
}
