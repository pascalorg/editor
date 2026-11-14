import type { CameraPose } from '@pascal-app/core'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

type CameraPoseState = {
  pose: CameraPose | null
}

export const cameraPoseStore = createStore<CameraPoseState>()(
  subscribeWithSelector<CameraPoseState>(() => ({ pose: null })),
)

export function publishCameraPose(pose: CameraPose) {
  cameraPoseStore.setState({ pose })
}

export function subscribeCameraPose(listener: (pose: CameraPose) => void) {
  const currentPose = cameraPoseStore.getState().pose
  if (currentPose) listener(currentPose)

  return cameraPoseStore.subscribe(
    (state) => state.pose,
    (pose) => {
      if (pose) listener(pose)
    },
  )
}
