import { subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import type { NavigationSyncPose } from './use-editor'

type NavigationSyncPoseState = {
  pose: NavigationSyncPose | null
}

export const navigationSyncPoseStore = createStore<NavigationSyncPoseState>()(
  subscribeWithSelector<NavigationSyncPoseState>(() => ({ pose: null })),
)

export function publishNavigationSyncPoseToStore(pose: NavigationSyncPose) {
  navigationSyncPoseStore.setState({ pose })
}

export function subscribeNavigationSyncPose(listener: (pose: NavigationSyncPose) => void) {
  const currentPose = navigationSyncPoseStore.getState().pose
  if (currentPose) listener(currentPose)

  return navigationSyncPoseStore.subscribe(
    (state) => state.pose,
    (pose) => {
      if (pose) listener(pose)
    },
  )
}
