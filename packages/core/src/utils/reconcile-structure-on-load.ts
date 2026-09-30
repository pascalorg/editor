import { automaticFloorHeight, floorPlateHoldsUnderside } from '../lib/floor-foundation-datum'
import { upperStoreyFootprints } from '../lib/floor-foundation-stack'
import { area, intersection } from '../lib/polygon-boolean'
import type { SceneNodes } from '../lib/structure-kernel'
import type { AnyNode, CeilingNode, SlabNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import { getCeilingClampBound } from '../services/storey'
import { planOwnedFloorOpenings } from '../systems/owned-floor-openings'
import { ensureSceneOpenings } from './ensure-scene-openings'
import { migrateExteriorThresholds } from './exterior-threshold-migration'
import { migrateFootprintFollowing } from './floor-follow-migration'
import { migrateFloorOpeningNodes } from './floor-opening-migration'
import { preserveLegacyWallDatums } from './legacy-wall-datums'
import { loadMigration, loadNodeView } from './load-migration'
import {
  materializeLegacyAutoOpenings,
  migrateOwnedFloorOpenings,
} from './owned-floor-opening-migration'
import { reconcileStructureWithStableIds } from './structure-id'

function roomHoles(slab: SlabNode | CeilingNode) {
  return (slab.holes ?? []).filter((_, i) => slab.holeMetadata?.[i]?.source === 'room')
}

function discardOrphanLegacySlabCuts(source: Record<string, unknown>) {
  let nodes = source
  for (const value of Object.values(source)) {
    const slab = value as SlabNode | CeilingNode
    if ((slab.type !== 'slab' && slab.type !== 'ceiling') || !slab.holes?.length) continue
    const kept = slab.holes.flatMap((hole, index) => {
      const metadata = slab.holeMetadata?.[index]
      const ownerId = metadata?.source === 'stair' ? metadata.stairId : metadata?.elevatorId
      const orphan =
        (metadata?.source === 'stair' || metadata?.source === 'elevator') &&
        (!ownerId || (source[ownerId] as AnyNode | undefined)?.type !== metadata.source)
      if (orphan) return []
      return [{ hole, metadata: metadata ?? { source: 'manual' as const } }]
    })
    if (kept.length === slab.holes.length) continue
    if (nodes === source) nodes = { ...source }
    nodes[slab.id] = {
      ...slab,
      holes: kept.map((entry) => entry.hole),
      holeMetadata: kept.map((entry) => entry.metadata),
    }
  }
  return nodes
}

function rehomeRetiredPlateCuts(source: Record<string, AnyNode>, legacy: Record<string, AnyNode>) {
  let nodes = source
  const plates = Object.values(source).filter(
    (node): node is SlabNode => node.type === 'slab' && node.plateRole !== undefined,
  )
  for (const opening of Object.values(source)) {
    if (opening.type !== 'floor-opening' || !opening.legacyPlateCuts) continue
    let cuts: typeof opening.legacyPlateCuts | undefined
    for (const [sourceId, rings] of Object.entries(opening.legacyPlateCuts)) {
      if (source[sourceId]?.type === 'slab') continue
      const former = legacy[sourceId]
      if (former?.type !== 'slab') continue
      const target = plates
        .filter(
          (plate) =>
            plate.parentId === former.parentId &&
            Math.abs(plate.elevation - former.elevation) < 0.005 &&
            rings.some((ring) => area(intersection(ring, plate.polygon)) > 1e-4),
        )
        .map((plate) => ({
          plate,
          overlap: area(intersection(former.polygon, plate.polygon)),
        }))
        .sort((a, b) => b.overlap - a.overlap || a.plate.id.localeCompare(b.plate.id))[0]?.plate
      if (!target) continue
      cuts ??= { ...opening.legacyPlateCuts }
      delete cuts[sourceId]
      cuts[target.id] = [...(cuts[target.id] ?? []), ...rings]
    }
    if (!cuts) continue
    if (nodes === source) nodes = { ...source }
    nodes[opening.id] = { ...opening, legacyPlateCuts: cuts }
  }
  return nodes
}

export function alignLegacyStairCuts(source: Record<string, AnyNode>) {
  let nodes = source
  const openings = Object.values(source).filter((node) => node.type === 'floor-opening')
  for (const opening of openings) {
    if (opening.source !== 'stair' || !opening.legacyPlateCuts) continue
    const stair = opening.ownerId ? source[opening.ownerId] : undefined
    if (stair?.type !== 'stair') continue
    const ceilings = openings.filter((other) => {
      if (
        other === opening ||
        other.source !== 'stair' ||
        other.parentId !== opening.parentId ||
        !other.ownerId ||
        other.ownerId.localeCompare(opening.ownerId ?? '') >= 0
      )
        return false
      const owner = other.ownerId ? source[other.ownerId] : undefined
      return (
        owner?.type === 'stair' &&
        owner.fromLevelId === stair.fromLevelId &&
        owner.toLevelId === stair.toLevelId &&
        other.legacyCeilingCuts !== undefined
      )
    })
    if (!ceilings.length) continue
    let cuts: typeof opening.legacyPlateCuts | undefined
    for (const [plateId, rings] of Object.entries(opening.legacyPlateCuts)) {
      const matched = rings.map((ring) => {
        const size = area([{ outer: ring, holes: [] }])
        const candidate = ceilings
          .flatMap((ceiling) => Object.values(ceiling.legacyCeilingCuts ?? {}).flat())
          .map((hole) => ({ hole, shared: area(intersection(ring, hole)) }))
          .sort((a, b) => b.shared - a.shared)[0]
        return candidate && candidate.shared >= size * 0.6 ? candidate.hole : ring
      })
      if (JSON.stringify(matched) === JSON.stringify(rings)) continue
      cuts ??= { ...opening.legacyPlateCuts }
      cuts[plateId] = matched
    }
    if (!cuts) continue
    if (nodes === source) nodes = { ...source }
    nodes[opening.id] = { ...opening, legacyPlateCuts: cuts }
  }
  return nodes
}

function reconcileStructureOnView(
  sourceNodes: Record<string, unknown>,
  legacyNodes: Record<string, unknown>,
  options: { legacyOpeningsPrepared?: boolean },
) {
  const legacyOpeningsPrepared =
    options.legacyOpeningsPrepared ||
    Object.values(sourceNodes).some(
      (node) =>
        (node as AnyNode).type === 'level' &&
        (node as AnyNode & { metadata?: { legacyAutoOpeningsMigrated?: boolean } }).metadata
          ?.legacyAutoOpeningsMigrated === true,
    )
  const materialized = legacyOpeningsPrepared
    ? sourceNodes
    : materializeLegacyAutoOpenings(sourceNodes)
  const legacyRecessed = Object.values(materialized).filter((node): node is SlabNode => {
    const slab = node as SlabNode
    return (
      slab.type === 'slab' &&
      slab.recessed === true &&
      slab.autoFromWalls === true &&
      !slab.boundary
    )
  })
  const openings = migrateFloorOpeningNodes(materialized)
  let input = legacyRecessed.length ? { ...openings.nodes } : openings.nodes
  input = ensureSceneOpenings(input).nodes
  for (const node of Object.values(sourceNodes)) {
    const plate = node as SlabNode
    if (
      plate.type !== 'slab' ||
      plate.plateRole !== 'base' ||
      plate.floorHeight === undefined ||
      !floorPlateHoldsUnderside(sourceNodes as Record<string, AnyNode>, plate)
    )
      continue
    const restingUnderside =
      automaticFloorHeight(sourceNodes as Record<string, AnyNode>, plate) - DEFAULT_SLAB_ELEVATION
    const { floorHeight, ...withoutLift } = plate
    if (input === openings.nodes) input = { ...openings.nodes }
    input[plate.id] = {
      ...withoutLift,
      elevation: floorHeight,
      thickness: Math.max(plate.thickness, floorHeight - restingUnderside),
      ...(plate.foundation?.type === 'solid'
        ? { foundation: { ...plate.foundation, type: 'none' } }
        : {}),
    }
  }
  // M4 deliberately leaves these authored recesses intact. Let their coverage
  // identify the room whose floor they supply without making them candidates for retirement.
  for (const slab of legacyRecessed) {
    input[slab.id] = { ...slab, autoFromWalls: false }
    for (const zone of Object.values(input)) {
      if (
        (zone as AnyNode).type !== 'zone' ||
        (zone as import('../schema').ZoneNode).parentId !== slab.parentId
      )
        continue
      const room = zone as import('../schema').ZoneNode
      if (room.floor?.sourceSlabId || room.hasFloor === false) continue
      const covered = area(intersection(room.polygon, slab.polygon))
      if (covered < area([{ outer: room.polygon, holes: room.holes }]) * 0.95) continue
      input[room.id] = { ...room, floor: { ...room.floor, sourceSlabId: slab.id } }
    }
  }
  input = migrateOwnedFloorOpenings(input).nodes
  input = rehomeRetiredPlateCuts(
    input as Record<string, AnyNode>,
    legacyNodes as Record<string, AnyNode>,
  )
  let result = reconcileStructureWithStableIds({ nodes: input as SceneNodes })
  if (
    result.patches.some(
      (patch) =>
        patch.op === 'update' &&
        (input[patch.id] as AnyNode | undefined)?.type === 'slab' &&
        'zoneIds' in patch.data,
    )
  ) {
    for (let pass = 0; pass < 2; pass++) {
      const settled = reconcileStructureWithStableIds({ nodes: result.nodes })
      if (!settled.patches.length) break
      result = settled
    }
  }
  let restoredNodes: Record<string, AnyNode> | undefined
  if (legacyRecessed.length) {
    restoredNodes = { ...result.nodes }
    for (const slab of legacyRecessed) restoredNodes[slab.id] = { ...slab, autoFromWalls: false }
  }
  for (const [id, node] of Object.entries(result.nodes)) {
    const before = input[id] as SlabNode | CeilingNode | undefined
    if (
      node === before ||
      (node.type !== 'slab' && node.type !== 'ceiling') ||
      before?.type !== node.type ||
      node.boundary !== 'auto' ||
      before.boundary !== 'auto' ||
      node.holeMetadata?.some((entry) => entry.source === 'floor-opening') ||
      before.holeMetadata?.some((entry) => entry.source === 'floor-opening') ||
      JSON.stringify([
        node.polygon,
        node.type === 'slab' ? node.zoneIds : node.zoneId,
        roomHoles(node),
      ]) !==
        JSON.stringify([
          before.polygon,
          before.type === 'slab' ? before.zoneIds : before.zoneId,
          roomHoles(before),
        ])
    )
      continue
    // Loading an unchanged plate must not clip or quantise saved user/stair holes.
    const metadataKey = (metadata: unknown) =>
      JSON.stringify(metadata && Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)))
    const savedHoles = before.holes ?? []
    const savedMetadata = before.holeMetadata ?? []
    const derivedMetadata = node.holeMetadata ?? []
    const oldCuts = new Set(savedMetadata.map(metadataKey))
    const added = (node.holes ?? []).flatMap((hole, index) =>
      oldCuts.has(metadataKey(derivedMetadata[index]))
        ? []
        : [{ hole, metadata: derivedMetadata[index] ?? { source: 'manual' as const } }],
    )
    const restored = {
      ...node,
      holes: [...savedHoles, ...added.map((entry) => entry.hole)],
      holeMetadata: [...savedMetadata, ...added.map((entry) => entry.metadata)],
    }
    restoredNodes ??= { ...result.nodes }
    restoredNodes[id] = JSON.stringify(restored) === JSON.stringify(before) ? before : restored
  }
  const cleaned = discardOrphanLegacySlabCuts(restoredNodes ?? result.nodes)
  const materializedOwned = legacyOpeningsPrepared
    ? cleaned
    : materializeLegacyAutoOpenings(cleaned)
  const owned = migrateOwnedFloorOpenings(materializedOwned)
  let nodes = owned.nodes as Record<string, AnyNode>
  const rehomed = rehomeRetiredPlateCuts(nodes, legacyNodes as Record<string, AnyNode>)
  nodes = alignLegacyStairCuts(rehomed)
  const intentChanges = planOwnedFloorOpenings(nodes, {
    skipExistingSurfaces: true,
    enforceReach: false,
    materializedNodes: materializedOwned as Record<string, AnyNode>,
  })
  if (intentChanges.length) {
    nodes = { ...nodes }
    for (const change of intentChanges) {
      if (change.op === 'create') nodes[change.node.id] = change.node
      else if (change.op === 'delete') delete nodes[change.id]
      else nodes[change.id] = { ...nodes[change.id], ...change.data } as AnyNode
    }
  }
  if (owned.changed || nodes !== owned.nodes || intentChanges.length)
    nodes = reconcileStructureWithStableIds({ nodes }).nodes as Record<string, AnyNode>
  nodes = ensureSceneOpenings(nodes).nodes
  nodes = preserveLegacyWallDatums(legacyNodes as Record<string, AnyNode>, nodes)
  for (const level of Object.values(nodes)) {
    if (level.type !== 'level' || !level.metadata?.legacyRoomMigrationPending) continue
    const { legacyRoomMigrationPending: _pending, ...metadata } = level.metadata
    nodes = { ...nodes, [level.id]: { ...level, metadata } }
  }
  const followed = migrateFootprintFollowing(nodes)
  // Walls that now follow the storey plane reach the ceilings, which stop at their faces.
  if (followed !== nodes)
    nodes = reconcileStructureWithStableIds({ nodes: followed }).nodes as Record<string, AnyNode>
  for (const ceiling of Object.values(nodes)) {
    if (ceiling.type !== 'ceiling' || ceiling.height === undefined || !ceiling.parentId) continue
    const saved = legacyNodes[ceiling.id] as CeilingNode | undefined
    // Loading never moves a saved height: the kernel's write clamp would drop a
    // legacy ceiling stored above its storey, which the scene has always shown there.
    if (saved?.type === 'ceiling' && saved.height !== undefined) {
      if (ceiling.height === saved.height) continue
      const restored = { ...ceiling, height: saved.height }
      const loaded = sourceNodes[ceiling.id]
      nodes = {
        ...nodes,
        [ceiling.id]:
          JSON.stringify(restored) === JSON.stringify(loaded) ? (loaded as AnyNode) : restored,
      }
      continue
    }
    const bound = getCeilingClampBound(ceiling.parentId, nodes, ceiling.polygon)
    if (ceiling.height > bound + 1e-6)
      nodes = { ...nodes, [ceiling.id]: { ...ceiling, height: bound } }
  }

  nodes = migrateExteriorThresholds(nodes, legacyNodes)

  if (
    Object.keys(nodes).length === Object.keys(sourceNodes).length &&
    Object.entries(nodes).every(([id, node]) => node === sourceNodes[id])
  ) {
    nodes = sourceNodes as SceneNodes
  }
  // Build the support map during load so the first height gesture stays responsive.
  upperStoreyFootprints(nodes)
  return { nodes, changed: nodes !== sourceNodes }
}

export const reconcileStructureOnLoad = loadMigration(
  'structure reconcile',
  (
    view: Record<string, unknown>,
    legacyNodes?: Record<string, unknown>,
    options: { legacyOpeningsPrepared?: boolean } = {},
  ) =>
    reconcileStructureOnView(
      view,
      legacyNodes === undefined ? view : loadNodeView(legacyNodes).view,
      options,
    ),
  (nodes) => ({ nodes: nodes as SceneNodes, changed: false }),
)
