import type { AnyNode, AnyNodeId, SlabNode } from '../schema'
import { getAuthoredLevelElevations } from '../services/storey'
import { floorFootprintName } from './floor-footprint-name'
import {
  automaticFloorHeight,
  floorPlateHoldsUnderside,
  footprintLift,
  footprintSupportsNode,
} from './floor-foundation-datum'
import { area } from './polygon-boolean'
import { type RoomFloorConflict, roundFloorElevation } from './room-floor-feasibility'

type Update = { id: AnyNodeId; data: Partial<AnyNode> }

export function isMeaningfulFloorFootprint(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): boolean {
  return (
    area([{ outer: plate.polygon, holes: plate.holes }]) >= 1.5 &&
    !!plate.zoneIds?.some((id) => nodes[id]?.type === 'zone' && nodes[id].spaceRole === 'room')
  )
}

const supportMemo = new WeakMap<object, { sources: AnyNode[]; result: Map<string, SlabNode[]> }>()

export function upperStoreyFootprints(
  nodes: Readonly<Record<string, AnyNode>>,
): ReadonlyMap<string, SlabNode[]> {
  const values = Object.values(nodes)
  const cached = supportMemo.get(nodes)
  if (
    cached &&
    cached.sources.length === values.length &&
    values.every((node, index) => node === cached.sources[index])
  )
    return cached.result
  const elevations = getAuthoredLevelElevations(nodes)
  const bases = values.filter(
    (node): node is SlabNode =>
      node.type === 'slab' && node.plateRole === 'base' && isMeaningfulFloorFootprint(nodes, node),
  )
  const basesByLevel = new Map<string, SlabNode[]>()
  for (const base of bases)
    if (base.parentId) {
      const group = basesByLevel.get(base.parentId) ?? []
      group.push(base)
      basesByLevel.set(base.parentId, group)
    }
  const contentsByLevel = new Map<string, AnyNode[]>()
  for (const node of values)
    if (
      node.parentId &&
      (node.type === 'slab' ||
        node.type === 'zone' ||
        node.type === 'ceiling' ||
        node.type === 'wall')
    ) {
      const group = contentsByLevel.get(node.parentId) ?? []
      group.push(node)
      contentsByLevel.set(node.parentId, group)
    }
  const result = new Map<string, SlabNode[]>()
  for (const [id, upper] of elevations) {
    const lowerLevels = [...elevations]
      .filter(([, entry]) => entry.buildingId === upper.buildingId && entry.ordinal < upper.ordinal)
      .sort((a, b) => b[1].ordinal - a[1].ordinal)
    if (!lowerLevels.length) continue
    const contents = [...(contentsByLevel.get(id) ?? [])].sort(
      (a, b) => Number(a.type === 'wall') - Number(b.type === 'wall'),
    )
    const owners = new Map<string, SlabNode>()
    for (const node of contents)
      for (const [lowerId] of lowerLevels) {
        const covering = (basesByLevel.get(lowerId) ?? []).filter((base) =>
          footprintSupportsNode(base, node, nodes),
        )
        if (!covering.length) continue
        for (const base of covering) owners.set(base.id, base)
        break
      }
    result.set(id, [...owners.values()])
  }
  supportMemo.set(nodes, { sources: values, result })
  return result
}

export function levelConstructionDisplacements(
  nodes: Readonly<Record<string, AnyNode>>,
  supports: ReadonlyMap<string, SlabNode[]> = upperStoreyFootprints(nodes),
): Map<string, number> {
  const elevations = getAuthoredLevelElevations(nodes)
  const result = new Map<string, number>()
  for (const [id] of [...elevations].sort((a, b) => a[1].ordinal - b[1].ordinal)) {
    const lifts = (supports.get(id) ?? []).map(
      (base) =>
        (result.get(base.parentId!) ?? 0) +
        footprintLift(nodes, (nodes[base.id]?.type === 'slab' ? nodes[base.id] : base) as SlabNode),
    )
    result.set(id, lifts.length ? Math.max(...lifts) : 0)
  }
  return result
}

export function changedLevelConstructionDisplacements(
  before: Readonly<Record<string, AnyNode>>,
  after: Readonly<Record<string, AnyNode>>,
): Set<string> {
  const changed = new Set<string>()
  const fields = [
    'floorHeight',
    'referenceFloorElevation',
    'elevation',
    'polygon',
    'holes',
    'zoneIds',
    'parentId',
    'plateRole',
  ] as const
  const ids = new Set([...Object.keys(before), ...Object.keys(after)])
  let geometryChanged = false
  let anyChanged = false
  for (const id of ids) {
    const old = before[id],
      next = after[id]
    if (old === next || (old?.type !== 'slab' && next?.type !== 'slab')) continue
    if (old?.type !== 'slab' || next?.type !== 'slab') {
      geometryChanged = true
      anyChanged = true
      continue
    }
    const different = fields.filter(
      (field) => JSON.stringify(old[field]) !== JSON.stringify(next[field]),
    )
    if (different.some((field) => field !== 'floorHeight' && field !== 'elevation'))
      geometryChanged = true
    if (different.length) anyChanged = true
  }
  if (!anyChanged) return changed
  const supports = geometryChanged ? undefined : upperStoreyFootprints(before)
  const old = levelConstructionDisplacements(before, supports)
  const next = levelConstructionDisplacements(after, supports)
  for (const id of new Set([...old.keys(), ...next.keys()]))
    if (Math.abs((old.get(id) ?? 0) - (next.get(id) ?? 0)) > 1e-6) changed.add(id)
  return changed
}

export function footprintStackChanges(
  nodes: Readonly<Record<string, AnyNode>>,
  changes: readonly Update[],
): { updates: Update[]; conflicts: RoomFloorConflict[] } {
  const deltas = new Map<string, number>()
  for (const { id, data } of changes) {
    const plate = nodes[id]
    if (
      plate?.type !== 'slab' ||
      plate.plateRole !== 'base' ||
      (!Object.hasOwn(data, 'floorHeight') && !Object.hasOwn(data, 'elevation'))
    )
      continue
    const delta = roundFloorElevation(
      ((data as Partial<SlabNode>).elevation ??
        (data as Partial<SlabNode>).floorHeight ??
        automaticFloorHeight(nodes, plate)) - (plate.floorHeight ?? plate.elevation),
    )
    if (delta) deltas.set(id, delta)
  }
  if (!deltas.size) return { updates: [], conflicts: [] }
  const values = Object.values(nodes)
  const bases = values.filter(
    (node): node is SlabNode =>
      node.type === 'slab' && node.plateRole === 'base' && isMeaningfulFloorFootprint(nodes, node),
  )
  const supports = upperStoreyFootprints(nodes)
  const conflicts: RoomFloorConflict[] = []
  const updates: Update[] = []
  const displacement = new Map<string, number>()
  const elevations = getAuthoredLevelElevations(nodes)
  const oldDisplacement = levelConstructionDisplacements(nodes)
  for (const [id, owners] of [...elevations.keys()]
    .map((levelId): [string, SlabNode[]] => [levelId, supports.get(levelId) ?? []])
    .sort(
      (a, b) =>
        (elevations.get(a[0])?.ordinal ?? Infinity) - (elevations.get(b[0])?.ordinal ?? Infinity),
    )) {
    if (nodes[id]?.type !== 'level') continue
    const shifts = owners.map(
      (base) =>
        (displacement.get(base.parentId!) ?? 0) +
        footprintLift(nodes, base) +
        (deltas.get(base.id) ?? 0),
    )
    displacement.set(id, shifts.length ? Math.max(...shifts) : 0)
    const moved = owners.find((base) => deltas.has(base.id))
    const reference = shifts[moved ? owners.indexOf(moved) : 0]!
    const other = owners.find((base, index) => Math.abs(shifts[index]! - reference) > 1e-6)
    const affected = owners.some(
      (base) =>
        deltas.has(base.id) ||
        Math.abs(
          (displacement.get(base.parentId!) ?? 0) - (oldDisplacement.get(base.parentId!) ?? 0),
        ) > 1e-6,
    )
    if (other && affected) {
      const subject = 'upper floor'
      conflicts.push({
        code: 'floor-foundation-shared-storey',
        severity: 'error',
        nodeIds: [id, ...owners.map((base) => base.id)],
        message: `The ${subject} also sits over ${floorFootprintName(nodes, other)}; raise both or neither.`,
      })
      continue
    }
    if (!moved) continue
    const delta = deltas.get(moved.id)!
    if (nodes[id]?.type !== 'level') continue
    const contents = values
      .filter((node) => node.parentId === id && node.type !== 'roof')
      .sort((a, b) => Number(a.type === 'wall') - Number(b.type === 'wall'))
    for (const plate of values) {
      if (
        plate.type !== 'slab' ||
        plate.plateRole !== 'base' ||
        plate.parentId !== moved.parentId ||
        isMeaningfulFloorFootprint(nodes, plate) ||
        changes.some((change) => change.id === plate.id) ||
        updates.some((change) => change.id === plate.id)
      )
        continue
      if (contents.some((node) => footprintSupportsNode(plate, node, nodes)))
        updates.push({
          id: plate.id,
          data: floorPlateHoldsUnderside(nodes, plate)
            ? {
                floorHeight: undefined,
                elevation: roundFloorElevation((plate.floorHeight ?? plate.elevation) + delta),
                thickness: roundFloorElevation(plate.thickness + delta),
              }
            : { floorHeight: roundFloorElevation((plate.floorHeight ?? plate.elevation) + delta) },
        })
    }
  }
  const affected = (base: SlabNode) =>
    deltas.has(base.id) ||
    Math.abs((displacement.get(base.parentId!) ?? 0) - (oldDisplacement.get(base.parentId!) ?? 0)) >
      1e-6
  const shifted = (base: SlabNode) =>
    (displacement.get(base.parentId!) ?? 0) +
    footprintLift(nodes, base) +
    (deltas.get(base.id) ?? 0)
  for (const node of values) {
    if (node.type !== 'roof' && node.type !== 'ceiling') continue
    const candidates = bases.filter((base) => base.parentId === node.parentId)
    if (!candidates.some((base) => affected(base) && footprintSupportsNode(base, node, nodes)))
      continue
    const owners = candidates.filter((base) => footprintSupportsNode(base, node, nodes))
    if (owners.length < 2) continue
    const reference = shifted(owners.find((base) => deltas.has(base.id)) ?? owners[0]!)
    const other = owners.find((base) => Math.abs(shifted(base) - reference) > 1e-6)
    if (other)
      conflicts.push({
        code: 'floor-foundation-shared-storey',
        severity: 'error',
        nodeIds: [node.id, ...owners.map((base) => base.id)],
        message: `The ${node.type} also sits over ${floorFootprintName(nodes, other)}; raise both or neither.`,
      })
  }
  return { updates, conflicts }
}
