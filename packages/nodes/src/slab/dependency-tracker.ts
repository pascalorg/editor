import {
  type AnyNode,
  type AnyNodeId,
  floorConstructionLift,
  getRenderableSlabPolygon,
  isFloorPlate,
  plateLevelContext,
  prepareSlabPolygonContext,
  type SlabNode,
  type SlabPolygonContext,
  scopeSlabPolygonContext,
  slabPolygonContextChanges,
  slabPolygonContextForLevel,
  type ZoneNode,
} from '@pascal-app/core'

type LevelContext = { slabs: SlabNode[] }
type CachedLevel = {
  prepared: ReturnType<typeof prepareSlabPolygonContext>
  transform: string
  partitionRevision: number
  slabs: Map<AnyNodeId, { node: SlabNode; signature: string; lift: number }>
  references: {
    level: AnyNode | undefined
    building: AnyNode | undefined
    slabs: SlabNode[]
    zones: ZoneNode[]
    openings: AnyNode[]
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
        ? [
            node.id,
            node.start,
            node.end,
            node.thickness,
            node.justification,
            node.curveOffset,
            node.supportSlabId,
            node.supportOffset,
            node.height,
          ]
        : node.type === 'slab'
          ? [
              node.id,
              node.polygon,
              node.holes,
              node.elevation,
              node.thickness,
              node.recessed,
              node.support,
              node.plateRole,
              node.fillToTerrain,
              node.floorHeight,
              node.foundation,
              node.boundary,
              node.zoneIds,
              node.slots,
            ]
          : node.type === 'door' || node.type === 'window'
            ? [node.id, node.parentId, node.position, node.width, node.height, node.verticalAnchor]
            : node.type === 'zone'
              ? [
                  node.id,
                  node.spaceRole,
                  node.hasFloor,
                  node.polygon,
                  node.holes,
                  node.floor,
                  node.floorStepFinish,
                  node.floorStepOverrides,
                  node.floorEdgeFinish,
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
      // Plates carry room finishes, so a zone edit changes what they draw even
      // when nothing about their own polygon moved.
      const { zones, openings = [] } = plateLevelContext(level ?? null, (id) => nodes[id])
      const references = {
        level,
        building,
        slabs: context.slabs,
        zones,
        openings,
        context: polygonContext,
      }
      if (
        cached &&
        cached.references.level === level &&
        cached.references.building === building &&
        sameReferences(cached.references.slabs, context.slabs) &&
        sameReferences(cached.references.zones, zones) &&
        sameReferences(cached.references.openings, openings) &&
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
        sameValues(cached.references.zones, zones) &&
        sameValues(cached.references.openings, openings) &&
        sameValues(cached.references.context.siblingSlabs, polygonContext.siblingSlabs)
      ) {
        current.set(levelId, { ...cached, references })
        continue
      }
      const slabs: CachedLevel['slabs'] = new Map()
      const prepared = prepareSlabPolygonContext(polygonContext, cached?.prepared)
      const affected = cached ? slabPolygonContextChanges(cached.prepared, prepared) : () => true
      // Reaching here means a wall, zone or slab on this level changed by value,
      // and a plate's top partition and side exposure read all three — so a
      // plate never takes the per-slab shortcut, whatever its own fields say.
      const partitionRevision = (cached?.partitionRevision ?? 0) + 1
      for (const slab of context.slabs) {
        const previousSlab = cached?.slabs.get(slab.id)
        const lift = isFloorPlate(slab) ? 0 : floorConstructionLift(nodes, slab)
        if (
          previousSlab &&
          previousSlab.lift === lift &&
          !isFloorPlate(slab) &&
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
          slab.elevation + lift,
          slab.thickness,
          slab.recessed,
          slab.fillToTerrain && !slab.recessed ? transform : null,
          isFloorPlate(slab) ? partitionRevision : null,
        ])
        slabs.set(slab.id, { node: slab, signature, lift })
        if (previousSlab?.signature !== signature) dirty.push(slab.id)
      }
      current.set(levelId, {
        prepared,
        transform: transformSignature,
        slabs,
        references,
        partitionRevision,
      })
    }
    previous = current
    return dirty
  }

  update(initialNodes)
  return update
}
