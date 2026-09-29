import type { AnyNode, AnyNodeId } from '../schema'
import { floorFootprintSupportClass } from './floor-foundation-datum'
import { createFloorOpeningIndex } from './floor-opening-intent'
import {
  type ExtractedRoom,
  extractRooms,
  pointToTuple,
  sampleWallPointsForRoomDetection,
  WALL_JUNCTION_TOLERANCE,
} from './room-graph'
import { RoomTopologyIndex } from './room-topology-index'
import {
  type NodePatch,
  reconcileLevelStructure,
  type SceneNodes,
  type StructureEvent,
} from './structure-kernel'

export type StructureIdFactory = (kind: 'zone' | 'ceiling' | 'slab' | 'separator') => string
export type SceneStructureInput = {
  nodes: SceneNodes
  levelIds?: string[]
  mintId: StructureIdFactory
  previousNodes?: SceneNodes
}
export type SceneStructureResult = {
  nodes: SceneNodes
  patches: NodePatch[]
  events: StructureEvent[]
}

function levelChildren(nodes: SceneNodes, levelId: string) {
  return Object.values(nodes)
    .filter((node) => node.parentId === levelId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function applyPatch(nodes: Record<string, AnyNode>, patch: NodePatch) {
  if (patch.op === 'delete') delete nodes[patch.id]
  else if (patch.op === 'create') nodes[patch.node.id] = patch.node
  else {
    const node = { ...nodes[patch.id], ...patch.data } as AnyNode
    for (const [key, value] of Object.entries(patch.data))
      if (value === undefined) delete (node as unknown as Record<string, unknown>)[key]
    nodes[patch.id] = node
  }
}

function affectedWalls(
  levelId: string,
  nodes: SceneNodes,
  previousNodes: SceneNodes,
  children: AnyNode[],
  previousChildren: AnyNode[],
) {
  const changed = new Set(
    [...children, ...previousChildren]
      .filter(
        (node) =>
          node.type === 'wall' &&
          JSON.stringify(nodes[node.id]) !== JSON.stringify(previousNodes[node.id]),
      )
      .map((node) => node.id),
  )
  if (!changed.size) return
  const index = new RoomTopologyIndex<ExtractedRoom>({
    detectRooms: extractRooms,
    sampleWall: (wall) => sampleWallPointsForRoomDetection(wall).map(pointToTuple),
    junctionTolerance: WALL_JUNCTION_TOLERANCE,
    includeSeparators: false,
  })
  return new Set(index.applyWallDelta(levelId, changed, previousNodes, nodes).examinedWallIds)
}

function supportInputsChanged(before: SceneNodes, after: SceneNodes) {
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = before[id],
      next = after[id]
    if (old === next) continue
    if (old?.type === 'slab' || next?.type === 'slab') {
      if (old?.type !== 'slab' || next?.type !== 'slab') return true
      if (old.plateRole === 'base' || next.plateRole === 'base') {
        if (old.plateRole !== next.plateRole) return true
        if (
          old.parentId !== next.parentId ||
          JSON.stringify([old.polygon, old.holes, old.zoneIds]) !==
            JSON.stringify([next.polygon, next.holes, next.zoneIds])
        )
          return true
      }
    }
    if (
      (old?.type === 'zone' && old.spaceRole === 'room') !==
      (next?.type === 'zone' && next.spaceRole === 'room')
    )
      return true
    if (old?.type === 'level' && next?.type === 'level')
      if (old.level !== next.level || old.parentId !== next.parentId) return true
  }
  return false
}

export function reconcileSceneStructure({
  nodes,
  levelIds,
  mintId,
  previousNodes,
}: SceneStructureInput): SceneStructureResult {
  const draft = { ...nodes }
  const events: StructureEvent[] = []
  const openingIndex = createFloorOpeningIndex(nodes)
  // Reconcile covering slabs before the ceilings on the level below them.
  const levels = [
    ...new Set(
      levelIds ??
        Object.values(nodes)
          .filter((node) => node.type === 'level')
          .map((node) => node.id),
    ),
  ].sort(
    (a, b) =>
      (nodes[b]?.type === 'level' ? nodes[b].level : 0) -
        (nodes[a]?.type === 'level' ? nodes[a].level : 0) || (a < b ? -1 : a > b ? 1 : 0),
  )
  const reconcileLevel = (levelId: string) => {
    if (draft[levelId]?.type !== 'level') return
    const children = levelChildren(draft, levelId)
    const previousChildren = previousNodes ? levelChildren(previousNodes, levelId) : []
    for (const surface of previousChildren) {
      if (
        (surface.type !== 'ceiling' && surface.type !== 'slab') ||
        surface.boundary !== 'auto' ||
        draft[surface.id]
      )
        continue
      const ids = surface.type === 'ceiling' ? [surface.zoneId] : (surface.zoneIds ?? [])
      for (const id of ids) {
        const zone = id ? draft[id] : undefined
        if (zone?.type === 'zone')
          draft[zone.id] = {
            ...zone,
            [surface.type === 'ceiling' ? 'hasCeiling' : 'hasFloor']: false,
          }
      }
    }
    const wallIds = previousNodes
      ? affectedWalls(levelId, nodes, previousNodes, children, previousChildren)
      : undefined
    const structure = reconcileLevelStructure({
      levelId,
      nodes: draft,
      mintId,
      previousNodes,
      openingIndex,
    })
    for (const patch of structure.patches) {
      // Preserve the indexed edit's wall scope: remote legacy walls must not
      // become a full-level rebuild merely because their sides were unclassified.
      if (
        patch.op === 'update' &&
        wallIds &&
        draft[patch.id]?.type === 'wall' &&
        !wallIds.has(patch.id)
      )
        continue
      applyPatch(draft, patch)
    }
    events.push(...structure.events)
  }
  for (const levelId of levels) reconcileLevel(levelId)
  const flipped = new Set<string | null>()
  if (supportInputsChanged(nodes, draft)) {
    const supportClasses = new Map(
      Object.values(nodes).flatMap((node) =>
        node.type === 'slab' && node.plateRole === 'base'
          ? [[node.id, floorFootprintSupportClass(nodes, node)] as const]
          : [],
      ),
    )
    for (const node of Object.values(draft))
      if (
        node.type === 'slab' &&
        node.plateRole === 'base' &&
        floorFootprintSupportClass(draft, node) !==
          (supportClasses.get(node.id) ?? 'ground-bearing')
      )
        flipped.add(node.parentId)
  }
  if (flipped.size) {
    for (const levelId of [...flipped]) {
      const index = levels.indexOf(levelId!)
      if (index >= 0 && index + 1 < levels.length) flipped.add(levels[index + 1]!)
    }
    for (const levelId of levels) if (flipped.has(levelId)) reconcileLevel(levelId)
  }
  const legacyCutsBySurface = new Map<
    string,
    Map<
      string,
      { hole: [number, number][]; metadata: { source: 'floor-opening'; openingId: string } }
    >
  >()
  for (const node of Object.values(draft)) {
    if (node.type !== 'floor-opening') continue
    for (const [surfaceId, cuts] of Object.entries({
      ...node.legacyPlateCuts,
      ...node.legacyCeilingCuts,
    }))
      for (const hole of cuts) {
        const byPolygon = legacyCutsBySurface.get(surfaceId) ?? new Map()
        const key = JSON.stringify(hole)
        const existing = byPolygon.get(key)
        if (!existing || node.id < existing.metadata.openingId)
          byPolygon.set(key, { hole, metadata: { source: 'floor-opening', openingId: node.id } })
        legacyCutsBySurface.set(surfaceId, byPolygon)
      }
  }
  const levelSet = new Set(levels)
  for (const surface of Object.values(draft)) {
    if (
      (surface.type !== 'slab' && surface.type !== 'ceiling') ||
      surface.boundary === 'auto' ||
      !levelSet.has(surface.parentId ?? '')
    )
      continue
    const desired = [...(legacyCutsBySurface.get(surface.id)?.values() ?? [])]
    const retained = (surface.holes ?? []).flatMap((hole, index) => {
      const metadata = surface.holeMetadata?.[index]
      if (metadata?.source !== 'floor-opening')
        return [{ hole, metadata: metadata ?? { source: 'manual' as const } }]
      const opening = metadata.openingId ? draft[metadata.openingId] : undefined
      return opening?.type === 'floor-opening' &&
        !opening.legacyPlateCuts?.[surface.id] &&
        !opening.legacyCeilingCuts?.[surface.id]
        ? [{ hole, metadata }]
        : []
    })
    const holes = [...retained, ...desired]
    if (
      JSON.stringify([surface.holes ?? [], surface.holeMetadata ?? []]) !==
      JSON.stringify([holes.map((entry) => entry.hole), holes.map((entry) => entry.metadata)])
    )
      draft[surface.id] = {
        ...surface,
        holes: holes.map((entry) => entry.hole),
        holeMetadata: holes.map((entry) => entry.metadata),
      }
  }
  const patches: NodePatch[] = []
  for (const id of [...new Set([...Object.keys(nodes), ...Object.keys(draft)])].sort()) {
    const before = nodes[id]
    const after = draft[id]
    if (before === after) continue
    if (!after) {
      patches.push({ op: 'delete', id: id as AnyNodeId })
      continue
    }
    if (!before) {
      patches.push({ op: 'create', node: after })
      continue
    }
    const data: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = (after as unknown as Record<string, unknown>)[key]
      if (
        JSON.stringify((before as unknown as Record<string, unknown>)[key]) !==
        JSON.stringify(value)
      )
        data[key] = value
    }
    if (Object.keys(data).length)
      patches.push({ op: 'update', id: after.id, data: data as Partial<AnyNode> })
    else draft[id] = before
  }
  return {
    nodes: patches.length ? draft : nodes,
    patches,
    events: events.filter(
      (event, index) =>
        events.findIndex((other) => JSON.stringify(other) === JSON.stringify(event)) === index,
    ),
  }
}
