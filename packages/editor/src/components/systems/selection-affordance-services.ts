import type { AnyNode, SceneApi } from '@pascal-app/core'

export type SelectionAffordanceHistoryApi = {
  depth: () => number
  replaceLatest: (expectedDepth: number, replace: () => boolean) => boolean
}

export type SelectionAffordanceInteractionApi = {
  beginInputDrag: () => () => void
  clearSelection: () => void
}

export type SelectionAffordanceProps = {
  historyApi: SelectionAffordanceHistoryApi
  interactionApi: SelectionAffordanceInteractionApi
  node: AnyNode
  readOnly: boolean
  sceneApi: SceneApi
}
