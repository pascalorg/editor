import {
  type AnyNode,
  type AnyNodeId,
  getRenderableSlabPolygon,
  type SlabNode,
  slabPolygonContextForLevel,
} from '@pascal-app/core'

type LevelContext = { slabs: SlabNode[] }
type CachedLevel = { inputs: string; slabs: Map<AnyNodeId, string> }

export function createSlabDependencyTracker(initialNodes: Record<string, AnyNode>) {
  let previous = new Map<string, CachedLevel>()

  const update = (nodes: Record<string, AnyNode>): AnyNodeId[] => {
    const levels = new Map<string, LevelContext>()
    for (const node of Object.values(nodes)) {
      if (!node.parentId || node.type !== 'slab') continue
      let context = levels.get(node.parentId)
      if (!context) {
        context = { slabs: [] }
        levels.set(node.parentId, context)
      }
      context.slabs.push(node)
    }

    const current = new Map<string, CachedLevel>()
    const dirty: AnyNodeId[] = []
    for (const [levelId, context] of levels) {
      if (context.slabs.length === 0) continue
      const level = nodes[levelId]
      const polygonContext = slabPolygonContextForLevel(
        level ?? null,
        (id) => nodes[id],
        context.slabs,
      )
      const building = level?.parentId ? nodes[level.parentId] : undefined
      const transform =
        building?.type === 'building' ? [building.id, building.position, building.rotation] : null
      const inputs = JSON.stringify([
        polygonContext.walls.map((wall) => [
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
        polygonContext.siblingSlabs.map((slab) => [
          slab.id,
          slab.polygon,
          slab.elevation,
          slab.thickness,
          slab.recessed,
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
          walls: polygonContext.walls,
          siblingSlabs: polygonContext.siblingSlabs.filter((sibling) => sibling.id !== slab.id),
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
