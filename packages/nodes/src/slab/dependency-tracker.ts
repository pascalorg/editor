import {
  type AnyNode,
  type AnyNodeId,
  getRenderableSlabPolygon,
  type SlabNode,
  type WallNode,
} from '@pascal-app/core'

type LevelContext = { walls: WallNode[]; slabs: SlabNode[] }
type CachedLevel = { inputs: string; slabs: Map<AnyNodeId, string> }

export function createSlabDependencyTracker(initialNodes: Record<string, AnyNode>) {
  let previous = new Map<string, CachedLevel>()

  const update = (nodes: Record<string, AnyNode>): AnyNodeId[] => {
    const levels = new Map<string, LevelContext>()
    for (const node of Object.values(nodes)) {
      if (!node.parentId || (node.type !== 'wall' && node.type !== 'slab')) continue
      let context = levels.get(node.parentId)
      if (!context) {
        context = { walls: [], slabs: [] }
        levels.set(node.parentId, context)
      }
      if (node.type === 'wall') context.walls.push(node)
      else context.slabs.push(node)
    }

    const current = new Map<string, CachedLevel>()
    const dirty: AnyNodeId[] = []
    for (const [levelId, context] of levels) {
      if (context.slabs.length === 0) continue
      const level = nodes[levelId]
      const building = level?.parentId ? nodes[level.parentId] : undefined
      const transform =
        building?.type === 'building' ? [building.id, building.position, building.rotation] : null
      const inputs = JSON.stringify([
        context.walls.map((wall) => [
          wall.id,
          wall.start,
          wall.end,
          wall.thickness,
          wall.curveOffset,
        ]),
        context.slabs.map((slab) => [
          slab.id,
          slab.polygon,
          slab.elevation,
          slab.thickness,
          slab.recessed,
          slab.fillToTerrain,
        ]),
        transform,
      ])
      const cached = previous.get(levelId)
      if (cached?.inputs === inputs) {
        current.set(levelId, cached)
        continue
      }
      const slabs = new Map<AnyNodeId, string>()
      for (const slab of context.slabs) {
        const polygon = getRenderableSlabPolygon(slab, {
          walls: context.walls,
          siblingSlabs: context.slabs.filter((sibling) => sibling.id !== slab.id),
        })
        // Compare the derived result: remote walls and seams can change the
        // level context without changing this slab's geometry.
        const signature = JSON.stringify([
          polygon,
          slab.elevation,
          slab.thickness,
          slab.recessed,
          slab.fillToTerrain && !slab.recessed ? transform : null,
        ])
        slabs.set(slab.id, signature)
        if (cached?.slabs.get(slab.id) !== signature) dirty.push(slab.id)
      }
      current.set(levelId, { inputs, slabs })
    }
    previous = current
    return dirty
  }

  update(initialNodes)
  return update
}
