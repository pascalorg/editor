import { subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

export type NavigationSyncSource = '2d' | '3d'

/** Where the plan is looking, shared between the 2D plan and the 3D camera. */
export type NavigationSyncPose = {
  source: NavigationSyncSource
  revision: number
  target: [number, number, number]
  azimuth: number
  viewWidth: number
}

export type NavigationSyncPoseInput = Omit<NavigationSyncPose, 'revision'>

type NavigationSyncPoseState = {
  pose: NavigationSyncPose | null
}

export const navigationSyncPoseStore = createStore<NavigationSyncPoseState>()(
  subscribeWithSelector<NavigationSyncPoseState>(() => ({ pose: null })),
)

export function publishNavigationSyncPose(pose: NavigationSyncPoseInput) {
  const revision = (navigationSyncPoseStore.getState().pose?.revision ?? 0) + 1
  navigationSyncPoseStore.setState({ pose: { ...pose, revision } })
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
