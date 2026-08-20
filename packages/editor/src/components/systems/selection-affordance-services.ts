import type { AnyNode, SceneApi } from '@pascal-app/core'

export type SelectionAffordanceHistoryApi = {
  depth: () => number
  replaceLatest: (expectedDepth: number, replace: () => boolean) => boolean
}

export type SelectionAffordanceProps = {
  historyApi: SelectionAffordanceHistoryApi
  node: AnyNode
  readOnly: boolean
  sceneApi: SceneApi
}
