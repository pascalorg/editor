// The overlay scope matrix — the "Sims-light" feel. During any non-idle
// interaction, two layers behave differently:
//
//  - 3D scene objects stay VISIBLE but become NON-pickable (the hot-set owns
//    what the active interaction can target). Context is preserved; you just
//    can't grab the wrong thing.
//  - DOM/HUD overlays step back, differentiated by how distracting they are:
//      zone labels      -> hidden (not a primary editing concern)
//      context badges   -> faded + pointer-events:none (hover name pills)
//      other controls   -> hard-hidden (other objects' handles, the floating
//                          action menu, conflicting controls)
//
// The active interaction's own affordances (ghost, snap guides, dimension
// labels, the active handle) always stay — "default-off, opt-in for the active
// action". The contextual control HUD is exempt from the pointer-events
// step-back because it *is* the active interaction's own controls.

import { type InteractionScope, isActive } from './scope'

export type OverlayVisibility = 'shown' | 'faded' | 'hidden'

export type OverlayPolicy = {
  zoneLabels: OverlayVisibility
  // Hover name pills / context badges.
  contextBadges: OverlayVisibility
  // Other objects' handles + the floating action menu — anything whose action
  // would conflict with the active interaction.
  conflictingControls: OverlayVisibility
  // Non-active scene objects: visible always, pickable only when idle.
  sceneObjectsPickable: boolean
  // The active interaction's own ghost/guides/dimension labels/handle. Always
  // shown; this field exists so consumers can assert the contract.
  activeAffordances: 'shown'
  // The contextual control HUD keeps pointer events even while everything else
  // steps back, because it is the active interaction's own controls.
  contextualHudInteractive: boolean
}

const IDLE_POLICY: OverlayPolicy = {
  zoneLabels: 'shown',
  contextBadges: 'shown',
  conflictingControls: 'shown',
  sceneObjectsPickable: true,
  activeAffordances: 'shown',
  contextualHudInteractive: true,
}

const ACTIVE_POLICY: OverlayPolicy = {
  zoneLabels: 'hidden',
  contextBadges: 'faded',
  conflictingControls: 'hidden',
  sceneObjectsPickable: false,
  activeAffordances: 'shown',
  contextualHudInteractive: true,
}

export function resolveOverlayPolicy(scope: InteractionScope): OverlayPolicy {
  return isActive(scope) ? ACTIVE_POLICY : IDLE_POLICY
}
