import { useScene } from '@pascal-app/core'

export const SCENE_IMMEDIATE_SAVE_EVENT = 'pascal:scene-immediate-save'

export function requestSceneImmediateSave() {
  if (typeof window === 'undefined') {
    return
  }

  const { collections, nodes, rootNodeIds } = useScene.getState()
  window.dispatchEvent(
    new CustomEvent(SCENE_IMMEDIATE_SAVE_EVENT, {
      detail: { collections, nodes, rootNodeIds },
    }),
  )
}
