import {
  LawnBuildError,
  LawnNode,
  planLawn,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'

type Point = [number, number]

export function createLawnOutlineSession(node: LawnNode) {
  let outline: Point[] | null = null
  const clear = () => {
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
  }
  const current = () => {
    const live = useScene.getState().nodes[node.id]
    return live?.type === 'lawn' && live.outline === node.outline ? live : null
  }
  const canCommit = () => !!outline && !!current()
  return {
    affectedIds: [node.id],
    preview(proposed: Point[]) {
      const live = current()
      const parsed = live ? LawnNode.safeParse({ ...live, outline: proposed }) : null
      outline = null
      if (!parsed?.success) {
        clear()
        return
      }
      try {
        planLawn(parsed.data, useScene.getState().nodes)
      } catch (error) {
        if (!(error instanceof LawnBuildError)) throw error
        clear()
        return
      }
      outline = parsed.data.outline
      useLiveNodeOverrides.getState().set(node.id, { outline })
      useScene.getState().markDirty(node.id)
    },
    canCommit,
    commit() {
      if (canCommit() && outline) {
        const live = current()
        if (live) {
          try {
            planLawn({ ...live, outline }, useScene.getState().nodes)
            useScene.getState().updateNode(node.id, { outline })
          } catch (error) {
            if (!(error instanceof LawnBuildError)) throw error
          }
        }
      }
      outline = null
      clear()
    },
    clear() {
      outline = null
      clear()
    },
  }
}
