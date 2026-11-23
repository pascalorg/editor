import { planRock, RockNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'

type Point = [number, number]

/** A rock's outline is the only field carried by a reshape or move. */
export function createRockPolygonSession(node: RockNode) {
  let polygon: Point[] | null = null
  let valid = false
  const clear = () => {
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
  }
  const canCommit = () => {
    const live = useScene.getState().nodes[node.id]
    return valid && !!polygon && live?.type === 'rock' && live.polygon === node.polygon
  }
  return {
    affectedIds: [node.id],
    preview(proposed: Point[]) {
      const live = useScene.getState().nodes[node.id]
      const parsed = RockNode.safeParse({ ...live, polygon: proposed })
      const plan = parsed.success ? planRock(parsed.data) : null
      valid =
        live?.type === 'rock' &&
        live.polygon === node.polygon &&
        parsed.success &&
        !!plan &&
        !plan.problem &&
        plan.withinBudget
      if (!valid) {
        polygon = null
        clear()
        return
      }
      polygon = proposed
      useLiveNodeOverrides.getState().set(node.id, { polygon })
      useScene.getState().markDirty(node.id)
    },
    canCommit,
    commit() {
      if (canCommit() && polygon) useScene.getState().updateNode(node.id, { polygon })
      clear()
    },
    clear,
  }
}
