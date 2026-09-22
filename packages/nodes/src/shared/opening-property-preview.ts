import {
  type AnyNodeId,
  type DoorNode,
  useLiveNodeOverrides,
  useScene,
  type WindowNode,
} from '@pascal-app/core'

import { constrainCurtainOpening } from './curtain-opening-limits'

export function createOpeningPropertyPreview<T extends DoorNode | WindowNode>(id: AnyNodeId) {
  let pending: Partial<T> | undefined
  const dirty = () => {
    const scene = useScene.getState()
    scene.markDirty(id)
    const parent = scene.nodes[id]?.parentId
    if (parent) scene.markDirty(parent as AnyNodeId)
  }
  const clear = () => {
    if (!pending) return
    useLiveNodeOverrides.getState().clearFields(id, Object.keys(pending))
    pending = undefined
    dirty()
  }
  return {
    preview(patch: Partial<T>) {
      const node = useScene.getState().nodes[id]
      if (node?.type !== 'door' && node?.type !== 'window') return
      patch = constrainCurtainOpening(node as T, patch, useScene.getState().nodes)
      pending = { ...pending, ...patch }
      useLiveNodeOverrides.getState().set(id, patch)
      dirty()
    },
    commit(patch?: Partial<T>) {
      const live = useLiveNodeOverrides.getState().get(id)
      if (pending && !Object.keys(pending).some((key) => live && key in live)) {
        clear()
        return
      }
      const current =
        pending && live
          ? Object.fromEntries(
              Object.keys(pending)
                .filter((key) => key in live)
                .map((key) => [key, live[key]]),
            )
          : undefined
      const node = useScene.getState().nodes[id]
      const updates =
        node?.type === 'door' || node?.type === 'window'
          ? constrainCurtainOpening(
              node as T,
              { ...current, ...patch } as Partial<T>,
              useScene.getState().nodes,
            )
          : {}
      if (Object.keys(updates).length) useScene.getState().updateNode(id, updates)
      clear()
    },
    cancel: clear,
  }
}
