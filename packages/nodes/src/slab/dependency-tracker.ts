import {
  type AnyNode,
  type AnyNodeId,
  getRenderableSlabPolygon,
  prepareSlabPolygonContext,
  type SlabNode,
  type SlabPolygonContext,
  scopeSlabPolygonContext,
  slabPolygonContextChanges,
  slabPolygonContextForLevel,
} from '@pascal-app/core'

type LevelContext = { slabs: SlabNode[] }
type CachedLevel = {
  prepared: ReturnType<typeof prepareSlabPolygonContext>
  transform: string
  slabs: Map<AnyNodeId, { node: SlabNode; signature: string }>
  references: {
    level: AnyNode | undefined
    building: AnyNode | undefined
    slabs: SlabNode[]
    context: SlabPolygonContext
  }
}

function sameReferences<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function createSlabDependencyTracker(initialNodes: Record<string, AnyNode>) {
  let previous = new Map<string, CachedLevel>()
  const nodeInputs = new WeakMap<AnyNode, string>()
  const sign = (node: AnyNode): string => {
    let value = nodeInputs.get(node)
    if (value !== undefined) return value
    value = JSON.stringify(
      node.type === 'wall'
        ? [node.id, node.start, node.end, node.thickness, node.curveOffset]
        : node.type === 'slab'
          ? [
              node.id,
              node.polygon,
              node.elevation,
              node.thickness,
              node.recessed,
              node.fillToTerrain,
            ]
          : null,
    )
    nodeInputs.set(node, value)
    return value
  }

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
      const cached = previous.get(levelId)
      const references = { level, building, slabs: context.slabs, context: polygonContext }
      if (
        cached &&
        cached.references.level === level &&
        cached.references.building === building &&
        sameReferences(cached.references.slabs, context.slabs) &&
        sameReferences(cached.references.context.walls, polygonContext.walls) &&
        sameReferences(cached.references.context.siblingSlabs, polygonContext.siblingSlabs)
      ) {
        current.set(levelId, cached)
        continue
      }
      const transform =
        building?.type === 'building' ? [building.id, building.position, building.rotation] : null
      const transformSignature = JSON.stringify(transform)
      const sameValues = <T extends AnyNode>(left: T[], right: T[]) =>
        left.length === right.length &&
        left.every((node, index) => node === right[index] || sign(node) === sign(right[index]!))
      if (
        cached &&
        cached.transform === transformSignature &&
        sameValues(cached.references.context.walls, polygonContext.walls) &&
        sameValues(cached.references.slabs, context.slabs) &&
        sameValues(cached.references.context.siblingSlabs, polygonContext.siblingSlabs)
      ) {
        current.set(levelId, { ...cached, references })
        continue
      }
      const slabs: CachedLevel['slabs'] = new Map()
      const prepared = prepareSlabPolygonContext(polygonContext, cached?.prepared)
      const affected = cached ? slabPolygonContextChanges(cached.prepared, prepared) : () => true
      for (const slab of context.slabs) {
        const previousSlab = cached?.slabs.get(slab.id)
        if (
          previousSlab &&
          (previousSlab.node === slab || sign(previousSlab.node) === sign(slab)) &&
          (!slab.fillToTerrain || slab.recessed || cached?.transform === transformSignature) &&
          !affected(slab)
        ) {
          slabs.set(slab.id, previousSlab)
          continue
        }
        const local = scopeSlabPolygonContext(slab, prepared)
        const polygon = getRenderableSlabPolygon(slab, local)
        // Compare the derived result: remote walls and seams can change the
        // level context without changing this slab's geometry.
        const signature = JSON.stringify([
          polygon,
          slab.elevation,
          slab.thickness,
          slab.recessed,
          slab.fillToTerrain && !slab.recessed ? transform : null,
        ])
        slabs.set(slab.id, { node: slab, signature })
        if (previousSlab?.signature !== signature) dirty.push(slab.id)
      }
      current.set(levelId, { prepared, transform: transformSignature, slabs, references })
    }
    previous = current
    return dirty
  }

  update(initialNodes)
  return update
}
