'use client'

import useNavigation from '../store/use-navigation'

let navigationSceneRestorePending = false

export function setNavigationSceneRestorePending(pending: boolean) {
  navigationSceneRestorePending = pending
}

export function shouldPauseNavigationAutoSave() {
  const navigationState = useNavigation.getState()
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const durableSceneSaveAllowed = navigationState.durableSceneSaveAllowedUntil > now
  return (
    navigationSceneRestorePending ||
    (navigationState.robotMode !== null && !durableSceneSaveAllowed)
  )
}
