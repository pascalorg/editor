import { boundaries, roomFace } from '../commands/structure/shared'
import type { AnyNode, AnyNodeId, CeilingNode, RoofNode, SlabNode, ZoneNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import {
  findLevelBelowId,
  getLevelElevations,
  getWallCoveringSlabUnderside,
  getWallPlaneTop,
} from '../services/storey'
import { resolveWallTop } from '../systems/wall/wall-top'
import {
  automaticFloorHeight,
  floorPlateAtGroundContact,
  floorPlateHoldsUnderside,
  footprintSupportsNode,
  supportDerivedFloorHeight,
} from './floor-foundation-datum'
import {
  changedLevelConstructionDisplacements,
  footprintStackChanges,
} from './floor-foundation-stack'
import { floorRoomFaces } from './floor-room-faces'
import { getOpeningFloorTarget, wallSupportForNodes } from './opening-floor-datum'
import { area, intersection } from './polygon-boolean'
import {
  checkRoomFloor,
  getRoomBaseElevation,
  type RoomFloorConflict,
  roundFloorElevation,
} from './room-floor-feasibility'

type Update = { id: AnyNodeId; data: Partial<AnyNode> }

export function expandFloorIntentChanges(
  nodes: Readonly<Record<string, AnyNode>>,
  updates: readonly Update[],
): Update[] {
  const intent = updates.map((update) => {
    const plate = nodes[update.id]
    const patch = update.data as Partial<SlabNode>
    if (plate?.type !== 'slab' || plate.plateRole !== 'base') return update
    // A reference rebase can need an explicit current top even when that top
    // equals the old resting height; normalizing it away would move the floor.
    if (Object.hasOwn(patch, 'referenceFloorElevation')) return update
    const supported = floorPlateHoldsUnderside(nodes, plate)
    if (supported) {
      if (
        !Object.hasOwn(patch, 'floorHeight') &&
        patch.thickness === undefined &&
        patch.elevation === undefined
      )
        return update
      const currentTop = plate.floorHeight ?? plate.elevation
      const nextTop =
        patch.floorHeight !== undefined
          ? (patch.floorHeight ?? automaticFloorHeight(nodes, plate))
          : patch.elevation !== undefined
            ? patch.elevation
            : currentTop + (patch.thickness ?? plate.thickness) - plate.thickness
      return {
        ...update,
        data: {
          ...update.data,
          floorHeight: undefined,
          thickness: roundFloorElevation(plate.thickness + nextTop - currentTop),
          elevation: roundFloorElevation(nextTop),
        } as Partial<AnyNode>,
      }
    }
    if (Object.hasOwn(patch, 'floorHeight')) {
      const resting = supportDerivedFloorHeight(nodes, plate)
      const atRest = patch.floorHeight == null || Math.abs(patch.floorHeight - resting) <= 0.001
      const keepExplicitRest =
        plate.referenceFloorElevation !== undefined &&
        Math.abs(plate.referenceFloorElevation - resting) > 0.001
      // The store guard can expand a normalized plan again. Its cleared height
      // must not erase the foundation already resolved for a raised top. The
      // slab sits on the foundation, so only a top above grade + thickness has one.
      const foundationHeight =
        (patch.floorHeight ?? resting) -
        (resting - DEFAULT_SLAB_ELEVATION) -
        (patch.thickness ?? plate.thickness)
      const foundation =
        foundationHeight <= 0.0005
          ? { ...plate.foundation, ...patch.foundation, type: 'none' as const }
          : (patch.foundation ??
            (patch.floorHeight == null
              ? { ...plate.foundation, type: 'none' as const }
              : plate.foundation?.type === 'solid'
                ? plate.foundation
                : {
                    type: 'solid' as const,
                    material: plate.foundation?.material ?? 'library:preset-midgrey',
                  }))
      return {
        ...update,
        data: {
          ...update.data,
          floorHeight: atRest && !keepExplicitRest ? undefined : (patch.floorHeight ?? resting),
          ...(foundation ? { foundation } : {}),
        } as Partial<AnyNode>,
      }
    }
    return update
  })
  const stack = footprintStackChanges(nodes, intent)
  const constructionUpdates = [...intent, ...stack.updates]
  const result = [...constructionUpdates]
  for (const update of constructionUpdates) {
    const plate = nodes[update.id]
    if (
      plate?.type !== 'slab' ||
      plate.plateRole !== 'base' ||
      (!Object.hasOwn(update.data, 'floorHeight') && !Object.hasOwn(update.data, 'elevation'))
    )
      continue
    const patch = update.data as Partial<typeof plate>
    const delta =
      (patch.elevation ?? patch.floorHeight ?? automaticFloorHeight(nodes, plate)) -
      (plate.floorHeight ?? plate.elevation)
    if (!delta) continue
    for (const zone of Object.values(nodes)) {
      if (
        zone.type !== 'zone' ||
        !(
          plate.zoneIds?.includes(zone.id) ||
          (zone.parentId === plate.parentId &&
            zone.floor?.support === 'open' &&
            area(intersection(plate.polygon, zone.polygon)) > 1e-6)
        ) ||
        zone.floor?.elevation === undefined
      )
        continue
      const index = result.findIndex((u) => u.id === zone.id)
      const data = index >= 0 ? (result[index]!.data as Partial<ZoneNode>) : {}
      if (data.floor && Object.hasOwn(data.floor, 'elevation')) continue
      const floor = data.floor ?? zone.floor
      if (floor?.elevation === undefined) continue
      const translated = {
        id: zone.id,
        data: {
          ...data,
          floor: { ...floor, elevation: roundFloorElevation(floor.elevation + delta) },
        },
      }
      if (index >= 0) result[index] = translated
      else result.push(translated)
    }
    for (const node of Object.values(nodes)) {
      if (node.parentId !== plate.parentId) continue
      let data: Partial<AnyNode> | undefined
      if (
        node.type === 'roof' &&
        (!node.support || node.support.kind === 'level') &&
        footprintSupportsNode(plate, node, nodes)
      )
        data = {
          position: [
            node.position[0],
            roundFloorElevation(node.position[1] + delta),
            node.position[2],
          ],
        }
      if (
        node.type === 'ceiling' &&
        node.height !== undefined &&
        footprintSupportsNode(plate, node, nodes)
      )
        data = { height: roundFloorElevation(node.height + delta) }
      if (!data) continue
      const existing = result.find((entry) => entry.id === node.id)
      if (!existing) result.push({ id: node.id, data })
      else if (!Object.keys(data).some((key) => Object.hasOwn(existing.data, key)))
        existing.data = { ...existing.data, ...data } as Partial<AnyNode>
    }
  }
  return result
}

export function floorIntentConflicts(
  nodes: Readonly<Record<string, AnyNode>>,
  updates: readonly Update[],
  created: readonly AnyNode[] = [],
  deleted: readonly string[] = [],
) {
  const stack = footprintStackChanges(nodes, updates)
  if (stack.conflicts.length) return stack.conflicts
  const groundOnly: RoomFloorConflict[] = updates.flatMap(({ id, data }) => {
    const plate = nodes[id]
    if (plate?.type !== 'slab' || plate.plateRole !== 'base') return []
    const patch = data as Partial<SlabNode>
    if (floorPlateAtGroundContact(nodes, plate)) return []
    if (patch.foundation?.type === 'solid')
      return [
        {
          code: 'floor-foundation-level',
          severity: 'error',
          nodeIds: [id],
          message: 'Only a plate at ground contact can have a solid foundation.',
        },
      ]
    return []
  })
  if (groundOnly.length) return groundOnly
  const draft = { ...nodes }
  for (const id of deleted) delete draft[id]
  for (const node of created) {
    draft[node.id] = node
  }
  for (const { id, data } of updates)
    if (draft[id]) draft[id] = { ...draft[id], ...data } as AnyNode
  for (const node of created) {
    const parent = node.parentId && draft[node.parentId]
    if (parent && 'children' in parent)
      draft[parent.id] = {
        ...parent,
        children: [...new Set([...parent.children, node.id])],
      } as AnyNode
  }
  for (const { id, data } of updates) {
    const plate = draft[id]
    if (
      plate?.type === 'slab' &&
      plate.plateRole === 'base' &&
      Object.hasOwn(data, 'floorHeight') &&
      !Object.hasOwn(data, 'elevation')
    )
      draft[id] = { ...plate, elevation: plate.floorHeight ?? automaticFloorHeight(nodes, plate) }
  }
  const changedDisplacements = changedLevelConstructionDisplacements(nodes, draft)
  const baseHeightChanges = updates.filter(
    ({ id, data }) =>
      nodes[id]?.type === 'slab' &&
      nodes[id].plateRole === 'base' &&
      (Object.hasOwn(data, 'floorHeight') || Object.hasOwn(data, 'elevation')),
  )
  if (
    !created.length &&
    !changedDisplacements.size &&
    baseHeightChanges.length &&
    baseHeightChanges.every(
      ({ id, data }) =>
        floorPlateAtGroundContact(nodes, nodes[id] as SlabNode) &&
        Object.keys(data).every(
          (key) =>
            ['floorHeight', 'foundation', 'slots', 'name'].includes(key) ||
            data[key as keyof typeof data] === nodes[id]![key as keyof AnyNode],
        ),
    )
  ) {
    const translated = new Map(
      expandFloorIntentChanges(nodes, baseHeightChanges).map((update) => [update.id, update.data]),
    )
    if (
      updates.every(({ id, data }) =>
        Object.entries(data).every(
          ([key, value]) =>
            ['slots', 'foundation', 'name'].includes(key) ||
            JSON.stringify(value) === JSON.stringify(translated.get(id)?.[key as keyof AnyNode]),
        ),
      )
    )
      return []
  }
  const verticalBases = updates.flatMap(({ id, data }) => {
    const plate = nodes[id]
    return plate?.type === 'slab' &&
      plate.plateRole === 'base' &&
      ['floorHeight', 'thickness', 'polygon', 'holes'].some((key) => Object.hasOwn(data, key))
      ? [{ plate, data: data as Partial<SlabNode> }]
      : []
  })
  const baseDeltas = verticalBases.map(({ plate, data }) =>
    Object.hasOwn(data, 'elevation')
      ? roundFloorElevation((data as Partial<SlabNode>).elevation! - plate.elevation)
      : Object.hasOwn(data, 'floorHeight')
        ? roundFloorElevation(
            (data.floorHeight ?? automaticFloorHeight(nodes, plate)) -
              (plate.floorHeight ?? plate.elevation),
          )
        : 0,
  )
  const matchesBaseDelta = (delta: number) =>
    baseDeltas.some((baseDelta) => Math.abs(baseDelta - delta) <= 1e-6)
  const baseOnly =
    !created.length &&
    verticalBases.length > 0 &&
    updates.every(({ id, data }) => {
      const node = nodes[id]
      if (node?.type === 'slab' && node.plateRole === 'base')
        return Object.keys(data).every((key) =>
          [
            'floorHeight',
            'elevation',
            'thickness',
            'polygon',
            'holes',
            'foundation',
            'slots',
            'name',
          ].includes(key),
        )
      if (node?.type === 'zone') {
        const floor = (data as Partial<ZoneNode>).floor
        return (
          Object.keys(data).every((key) => key === 'floor') &&
          floor?.elevation !== undefined &&
          matchesBaseDelta(floor.elevation - (node.floor?.elevation ?? 0))
        )
      }
      if (node?.type === 'ceiling')
        return (
          Object.keys(data).every((key) => key === 'height') &&
          typeof (data as Partial<CeilingNode>).height === 'number' &&
          matchesBaseDelta((data as Partial<CeilingNode>).height! - (node.height ?? 0))
        )
      if (node?.type === 'roof') {
        const position = (data as Partial<RoofNode>).position
        return (
          Object.keys(data).every((key) => key === 'position') &&
          Array.isArray(position) &&
          matchesBaseDelta(position[1] - node.position[1])
        )
      }
      return false
    })
  const loweringPlates = verticalBases.filter(({ plate, data }) => {
    if (Object.hasOwn(data, 'polygon') || Object.hasOwn(data, 'holes')) return true
    const top = Object.hasOwn(data, 'elevation')
      ? data.elevation!
      : Object.hasOwn(data, 'floorHeight')
        ? (data.floorHeight ?? automaticFloorHeight(nodes, plate))
        : (plate.floorHeight ?? plate.elevation)
    return (
      top - (data.thickness ?? plate.thickness) <
      (plate.floorHeight ?? plate.elevation) - plate.thickness - 1e-6
    )
  })
  if (baseOnly && !loweringPlates.length) return []
  const levels = new Set<string>()
  const relevant = [
    'floor',
    'floorHeight',
    'thickness',
    'height',
    'verticalAnchor',
    'width',
    'position',
    'start',
    'end',
    'curveOffset',
    'justification',
    'supportSlabId',
    'supportOffset',
    'parentId',
    'children',
    'hasFloor',
    'elevation',
    'baseElevation',
    'polygon',
    'holes',
    'level',
  ]
  if (!baseOnly) {
    for (const { id, data } of [
      ...updates,
      ...created.map((node) => ({ id: node.id, data: node })),
    ]) {
      if (!relevant.some((key) => Object.hasOwn(data, key))) continue
      for (const graph of [nodes, draft]) {
        let node = graph[id]
        const visited = new Set<string>()
        while (node && node.type !== 'level' && !visited.has(node.id)) {
          visited.add(node.id)
          node = node.parentId ? graph[node.parentId] : undefined!
        }
        if (node?.type === 'level') levels.add(node.id)
      }
    }
  }
  if (!baseOnly) for (const id of changedDisplacements) levels.add(id)
  if (
    updates.some(({ id, data }) => {
      const plate = nodes[id] ?? draft[id]
      return (
        plate?.type === 'slab' &&
        plate.plateRole === 'base' &&
        ['thickness', 'floorHeight', 'polygon', 'holes'].some((field) => Object.hasOwn(data, field))
      )
    })
  ) {
    for (const graph of [nodes, draft]) {
      const elevations = getLevelElevations(graph)
      for (const { id, data } of updates) {
        const plate = graph[id]
        if (
          plate?.type !== 'slab' ||
          plate.plateRole !== 'base' ||
          !['thickness', 'floorHeight', 'polygon', 'holes'].some((field) =>
            Object.hasOwn(data, field),
          )
        )
          continue
        const levelId = plate.parentId
        if (!levelId) continue
        const below = findLevelBelowId(levelId, elevations)
        if (below) levels.add(below)
      }
    }
  }
  if (baseOnly && !levels.size) return []
  const edited = new Set([...updates.map((u) => u.id), ...created.map((n) => n.id)])
  const zoneOnly = [...edited].every((id) => draft[id]?.type === 'zone')
  const affectedWalls = new Set<string>()
  const spans = (graph: Readonly<Record<string, AnyNode>>, zone: ZoneNode) =>
    roomFace(graph, zone, floorRoomFaces(boundaries(graph, zone.parentId!)))?.spans ?? []
  if (zoneOnly)
    for (const id of edited)
      for (const graph of [nodes, draft]) {
        const zone = graph[id]
        if (zone?.type === 'zone') {
          if (zone.boundaryWallIds?.length)
            for (const id of zone.boundaryWallIds) affectedWalls.add(id)
          else for (const span of spans(graph, zone)) affectedWalls.add(span.boundaryId)
        }
      }
  const ids = Object.values(draft).flatMap((node) =>
    node.type === 'zone' &&
    levels.has(node.parentId!) &&
    (!baseOnly || verticalBases.some(({ plate }) => footprintSupportsNode(plate, node, draft))) &&
    (!zoneOnly ||
      edited.has(node.id) ||
      (node.boundaryWallIds?.some((id) => affectedWalls.has(id)) ??
        spans(draft, node).some((span) => affectedWalls.has(span.boundaryId))))
      ? [node.id]
      : [],
  )

  const conflicts = [...ids].flatMap((id) => {
    const zone = draft[id] as ZoneNode
    if (zone.floor?.support === 'open' || zone.spaceRole !== 'room' || zone.hasFloor === false)
      return []
    const elevation = zone.floor?.elevation ?? getRoomBaseElevation(draft, zone.id)
    const check = checkRoomFloor(draft, id, elevation)
    const previous = nodes[id]
    const oldElevation =
      previous?.type === 'zone'
        ? (previous.floor?.elevation ?? getRoomBaseElevation(nodes, id))
        : elevation
    const before = previous?.type === 'zone' ? checkRoomFloor(nodes, id, oldElevation) : undefined
    return check.conflicts.filter(
      (c) =>
        c.severity === 'error' &&
        c.code !== 'floor-opening-fit' &&
        !before?.conflicts.some(
          (old) =>
            old.code === c.code &&
            JSON.stringify(old.nodeIds) === JSON.stringify(c.nodeIds) &&
            (c.excess ?? Infinity) <= (old.excess ?? 0) + 1e-6,
        ),
    )
  })
  for (const node of Object.values(draft)) {
    if (node.type !== 'door' && node.type !== 'window') continue
    const wall = draft[node.parentId!]
    if (
      wall?.type !== 'wall' ||
      !levels.has(wall.parentId!) ||
      (baseOnly && !verticalBases.some(({ plate }) => footprintSupportsNode(plate, wall, draft))) ||
      (zoneOnly && !affectedWalls.has(wall.id))
    )
      continue
    const excess = (graph: Readonly<Record<string, AnyNode>>, opening: typeof node) => {
      const host = graph[opening.parentId!]
      if (host?.type !== 'wall') return -Infinity
      return (
        getOpeningFloorTarget(host, opening, graph) +
        opening.position[1] +
        opening.height / 2 -
        resolveWallTop(
          host,
          getWallPlaneTop(host, host.parentId!, graph),
          wallSupportForNodes(host, graph).elevation,
        )
      )
    }
    const after = excess(draft, node)
    const previous = nodes[node.id]
    const before =
      previous?.type === 'door' || previous?.type === 'window' ? excess(nodes, previous) : -Infinity
    if (
      after > 1e-6 &&
      after > before + 1e-6 &&
      !conflicts.some((c) => c.code === 'floor-opening-fit' && c.nodeIds.includes(node.id))
    )
      conflicts.push({
        code: 'floor-opening-fit',
        severity: 'error',
        nodeIds: [node.id],
        excess: after,
        message: `The ${node.type} does not fit: it exceeds its wall top by ${roundFloorElevation(after)} m.`,
      })
  }
  for (const node of Object.values(draft)) {
    if (
      node.type !== 'wall' ||
      node.height === undefined ||
      !levels.has(node.parentId!) ||
      !loweringPlates.some(({ plate }) => footprintSupportsNode(plate, node, draft))
    )
      continue
    const excess = (graph: Readonly<Record<string, AnyNode>>, wall: typeof node) =>
      resolveWallTop(
        wall,
        getWallPlaneTop(wall, wall.parentId!, graph),
        wallSupportForNodes(wall, graph).elevation,
      ) - (getWallCoveringSlabUnderside(wall, wall.parentId!, graph) ?? Infinity)
    const after = excess(draft, node)
    const previous = nodes[node.id]
    const before = previous?.type === 'wall' ? excess(nodes, previous) : -Infinity
    if (after > 1e-6 && after > before + 1e-6)
      conflicts.push({
        code: 'floor-wall-fit',
        severity: 'error',
        nodeIds: [node.id],
        excess: after,
        message: `The wall top exceeds the floor above by ${roundFloorElevation(after)} m.`,
      })
  }
  return conflicts
}
