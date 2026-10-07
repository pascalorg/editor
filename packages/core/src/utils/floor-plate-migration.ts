import { isFloorAnchoredOpening } from '../lib/floor-opening-footprints'
import { floorPlateId } from '../lib/floor-plate-id'
import {
  buildFloorPlates,
  footprintIoU,
  type PlateRoom,
  parseSlabConstruction,
  slabFootprint,
  warnPlateFailure,
} from '../lib/floor-plates'
import { floorRoomFaces } from '../lib/floor-room-faces'
import { plateFootprint } from '../lib/level-footprints'
import { getOpeningFloorDatum, wallSupportForNodes } from '../lib/opening-floor-datum'
import { replacementPlateFor } from '../lib/plate-reference'
import { computePlateSurfacePartition } from '../lib/plate-surface'
import {
  area,
  containsPoint,
  difference,
  distanceToBoundary,
  intersection,
  type MultiPolygon,
  type Ring,
  union,
} from '../lib/polygon-boolean'
import { autoRoomVerticalPlacements } from '../lib/room-vertical-placement'
import { getRenderableSlabPolygon, prepareSlabPolygonContext } from '../lib/slab-polygon'
import type { AnyNode, SeparatorNode, WallNode, ZoneNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION, type SlabNode } from '../schema/nodes/slab'
import { getStoredLevelHeight } from '../services/storey'
import { wallOverlapsSlabFootprint } from '../systems/slab/slab-support'
import { getWallCurveLength } from '../systems/wall/wall-curve'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { resolveWallTop } from '../systems/wall/wall-top'
import {
  type FloorPieceAdoption,
  floorPieceFinish,
  PIECE_GAP_WIDTH,
  PIECE_TRIM_DEPTH,
  partWidth,
  planFloorPieceAdoption,
} from './floor-piece-adoption'
import { legacyWallElevations } from './legacy-wall-datums'
import { loadMigration } from './load-migration'
import { omitUndefined } from './omit-undefined'

export type FloorPlateMigrationReport = {
  code: 'floor-moved' | 'finish-not-visible' | 'region-limit' | 'floor-pieces-absorbed'
  nodeId: string
  finish?: unknown
  /** floor-pieces-absorbed: the hand-drawn slabs one generated plate replaced. */
  pieces?: string[]
  /** floor-pieces-absorbed: visible floor dropped past the walls / narrow gaps closed (m²). */
  trimmed?: number
  closed?: number
  /** floor-pieces-absorbed: uncovered room floor kept open as plate holes. */
  holes?: number
}

function visibleFloorTopAreas(slabs: SlabNode[], walls: Ring[]) {
  let covered = union(walls)
  const tops = new Map<number, number>()
  for (const slab of [...slabs].sort((a, b) => b.elevation - a.elevation)) {
    if (slab.visible === false || slab.support === 'open' || slab.recessed) continue
    const footprint = difference(
      { outer: slab.polygon, holes: [] },
      union((slab.holes ?? []).map((hole) => ({ outer: hole, holes: [] }))),
    )
    const visible = difference(footprint, covered)
    const top = Math.round(slab.elevation * 1000) / 1000
    tops.set(top, (tops.get(top) ?? 0) + area(visible))
    covered = union([...covered, ...footprint])
  }
  return tops
}

function visibleFloorTopChange(before: SlabNode[], after: SlabNode[], walls: Ring[]) {
  const old = visibleFloorTopAreas(before, walls)
  const next = visibleFloorTopAreas(after, walls)
  for (const [oldTop] of old)
    for (const [nextTop, nextArea] of next) {
      if (Math.abs(oldTop - nextTop) > 0.02 + 1e-9) continue
      const oldArea = old.get(oldTop)!
      const shared = Math.min(oldArea, nextArea)
      old.set(oldTop, oldArea - shared)
      next.set(nextTop, nextArea - shared)
      if (old.get(oldTop)! <= 1e-6) break
    }
  return Math.min(
    [...old.values()].reduce((sum, value) => sum + value, 0),
    [...next.values()].reduce((sum, value) => sum + value, 0),
  )
}

export function associateLegacyManualFloors(
  source: Record<string, AnyNode>,
  legacy: Readonly<Record<string, AnyNode>> = source,
  finalize = true,
) {
  const bounds = (ring: Ring) => ({
    minX: Math.min(...ring.map(([x]) => x)),
    maxX: Math.max(...ring.map(([x]) => x)),
    minZ: Math.min(...ring.map(([, z]) => z)),
    maxZ: Math.max(...ring.map(([, z]) => z)),
  })
  const nearby = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) =>
    a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ
  let nodes = source
  for (const level of Object.values(source)) {
    if (level.type !== 'level' || level.metadata?.floorOwnershipMigrated === true) continue
    const children = Object.values(source).filter((node) => node.parentId === level.id)
    const authored = children.filter(
      (node): node is SlabNode =>
        node.type === 'slab' &&
        !node.autoFromWalls &&
        node.boundary !== 'auto' &&
        node.support !== 'open' &&
        !node.recessed,
    )
    const manual = union(authored.map(slabFootprint))
    const original = Object.values(legacy).filter(
      (node): node is SlabNode =>
        node.type === 'slab' &&
        node.parentId === level.id &&
        node.visible !== false &&
        node.support !== 'open' &&
        !node.recessed,
    )
    const originalFaces = original.map((slab) => ({
      slab,
      footprint: slabFootprint(slab),
      coverageFootprint: {
        outer: slab.polygon,
        holes: (slab.holes ?? []).filter(
          (_, index) =>
            slab.holeMetadata?.[index]?.source !== 'stair' &&
            slab.holeMetadata?.[index]?.source !== 'elevator',
        ),
      },
      bounds: bounds(slab.polygon),
    }))
    const rooms = children.filter(
      (node): node is ZoneNode => node.type === 'zone' && node.spaceRole === 'room',
    )
    const wallBand =
      Math.max(
        0,
        ...children
          .filter((node) => node.type === 'wall')
          .map((wall) => (wall.thickness ?? 0.1) / 2),
      ) + 0.005
    for (const slab of authored) {
      const associatedZoneIds = rooms
        .filter((room) => area(intersection(slabFootprint(room), slabFootprint(slab))) > 1e-4)
        .map((room) => room.id)
        .sort()
      if (JSON.stringify(slab.associatedZoneIds) === JSON.stringify(associatedZoneIds)) continue
      if (nodes === source) nodes = { ...source }
      nodes[slab.id] = { ...slab, associatedZoneIds }
    }
    for (const zone of children) {
      if (
        zone.type !== 'zone' ||
        zone.spaceRole !== 'room' ||
        zone.hasFloor === false ||
        zone.floor?.support === 'open' ||
        zone.floor?.sourceSlabId
      )
        continue
      const face = slabFootprint(zone)
      const faceArea = area([face])
      if (faceArea <= 0) continue
      const faceBounds = bounds(zone.polygon)
      const originalOverlaps = originalFaces
        .filter((entry) => nearby(faceBounds, entry.bounds))
        .map((entry) => ({
          ...entry,
          overlap: intersection(face, entry.coverageFootprint),
        }))
      const supportArea = area(union(originalOverlaps.flatMap((entry) => entry.overlap)))
      if (supportArea <= 1e-4) {
        if (nodes === source) nodes = { ...source }
        nodes[zone.id] = { ...zone, hasFloor: false }
        continue
      }
      const nearWholeAutoPlate = originalOverlaps.some((entry) => {
        const plateBounds = entry.bounds
        return (
          entry.slab.autoFromWalls &&
          area(entry.overlap) >= faceArea * 0.8 &&
          Math.abs(plateBounds.minX - faceBounds.minX) <= wallBand &&
          Math.abs(plateBounds.maxX - faceBounds.maxX) <= wallBand &&
          Math.abs(plateBounds.minZ - faceBounds.minZ) <= wallBand &&
          Math.abs(plateBounds.maxZ - faceBounds.maxZ) <= wallBand
        )
      })
      if (
        !nearWholeAutoPlate &&
        supportArea > 1e-4 &&
        faceArea - supportArea > Math.max(0.02, faceArea * 0.01)
      ) {
        const provider = originalOverlaps
          .filter((entry) => area(entry.overlap) > 1e-4)
          .sort(
            (a, b) =>
              b.slab.elevation - a.slab.elevation ||
              area(b.overlap) - area(a.overlap) ||
              a.slab.id.localeCompare(b.slab.id),
          )[0]?.slab
        // A partial provider that became a generated plate supplies no authored floor.
        if (provider && !(nodes[provider.id] as SlabNode | undefined)?.plateRole) {
          if (nodes === source) nodes = { ...source }
          nodes[zone.id] = { ...zone, floor: { ...zone.floor, sourceSlabId: provider.id } }
        }
        continue
      }
      if (area(intersection(face, manual)) <= 1e-4) continue
      const provider = authored
        .filter((slab) => nearby(faceBounds, bounds(slab.polygon)))
        .map((slab) => ({ slab, overlap: area(intersection(face, slabFootprint(slab))) }))
        .filter(
          ({ slab, overlap }) =>
            overlap >= faceArea * 0.05 ||
            (overlap > 1e-4 &&
              (slab.metadata?.plateMigration as { demoted?: string } | undefined)?.demoted !==
                undefined),
        )
        .sort(
          (a, b) =>
            b.slab.elevation - a.slab.elevation ||
            b.overlap - a.overlap ||
            a.slab.id.localeCompare(b.slab.id),
        )[0]?.slab
      if (!provider) continue
      const providerCoverage = area(intersection(face, slabFootprint(provider)))
      const automaticCover = originalFaces
        .filter((entry) => entry.slab.autoFromWalls && nearby(faceBounds, entry.bounds))
        .reduce((best, entry) => Math.max(best, area(intersection(face, entry.footprint))), 0)
      if (automaticCover >= faceArea * 0.95 && providerCoverage < faceArea * 0.95) continue
      const finishOnly =
        (provider.metadata?.plateMigration as { demoted?: string } | undefined)?.demoted ===
          undefined &&
        providerCoverage >= faceArea * 0.95 &&
        Object.values(legacy).some(
          (node) =>
            node.type === 'slab' &&
            node.parentId === level.id &&
            node.autoFromWalls &&
            Math.abs(node.elevation - provider.elevation) <= 0.02 + 1e-9 &&
            provider.thickness <= node.thickness + 0.02 + 1e-9 &&
            area(difference(slabFootprint(provider), slabFootprint(node))) <=
              Math.max(1e-6, area([slabFootprint(provider)]) * 0.01),
        )
      if (finishOnly) continue
      if (nodes === source) nodes = { ...source }
      nodes[zone.id] = { ...zone, floor: { ...zone.floor, sourceSlabId: provider.id } }
    }
    if (finalize) {
      if (nodes === source) nodes = { ...source }
      const hadLegacyAutoPlate = Object.values(legacy).some(
        (node) =>
          node.type === 'slab' &&
          node.parentId === level.id &&
          node.autoFromWalls &&
          !node.plateRole,
      )
      nodes[level.id] = {
        ...level,
        metadata: {
          ...level.metadata,
          floorOwnershipMigrated: true,
          ...(hadLegacyAutoPlate ? { legacyAutoOpeningsMigrated: true } : {}),
        },
      }
    }
  }
  return nodes
}

function convertLegacyFinishSlabs(source: Record<string, AnyNode>) {
  let nodes = source
  const slabs = Object.values(source).filter((node): node is SlabNode => node.type === 'slab')
  for (const slab of slabs) {
    if (
      slab.autoFromWalls ||
      slab.boundary === 'auto' ||
      slab.plateRole ||
      slab.support === 'open' ||
      slab.recessed ||
      slab.visible === false ||
      slab.holes?.length ||
      !slab.parentId
    )
      continue
    const finish = slab.slots?.surface ?? slab.material ?? slab.materialPreset
    if (finish === undefined) continue
    if (
      Object.values(source).some(
        (node) =>
          node.id !== slab.id &&
          ((node as { supportSlabId?: string }).supportSlabId === slab.id ||
            (node as { deckSlabId?: string }).deckSlabId === slab.id),
      )
    )
      continue
    const footprint = slabFootprint(slab)
    const auto = slabs.filter(
      (other) =>
        other.parentId === slab.parentId &&
        (other.autoFromWalls || other.boundary === 'auto') &&
        !other.plateRole &&
        Math.abs(other.elevation - slab.elevation) <= 0.02 + 1e-9 &&
        slab.thickness <= other.thickness + 0.02 + 1e-9,
    )
    if (!auto.length || area(difference(footprint, union(auto.map(slabFootprint)))) > 1e-4) continue
    const rooms = Object.values(nodes).filter(
      (node): node is ZoneNode =>
        node.type === 'zone' &&
        node.parentId === slab.parentId &&
        node.spaceRole === 'room' &&
        node.hasFloor !== false,
    )
    const pieces = rooms.flatMap((room) =>
      intersection(footprint, slabFootprint(room)).map((part) => ({ room, part })),
    )
    if (
      pieces.some(({ part }) => part.holes.length) ||
      area(difference(footprint, union(pieces.map(({ part }) => part)))) > 1e-4
    )
      continue
    if (nodes === source) nodes = { ...source }
    for (const room of rooms) {
      const regions = pieces
        .filter((piece) => piece.room.id === room.id)
        .map(({ part }, index) => ({
          id: pieces.length === 1 ? slab.id : `${slab.id}_${room.id}_${index}`,
          polygon: part.outer,
          finish,
        }))
      if (!regions.length) continue
      const { sourceSlabId, ...floor } = room.floor ?? {}
      nodes[room.id] = {
        ...room,
        floor: {
          ...floor,
          ...(sourceSlabId && sourceSlabId !== slab.id ? { sourceSlabId } : {}),
          regions: [...(floor.regions ?? []), ...regions],
        },
      }
    }
    const level = nodes[slab.parentId]
    if (level?.type === 'level')
      nodes[level.id] = { ...level, children: level.children.filter((id) => id !== slab.id) }
    delete nodes[slab.id]
  }
  return nodes
}

function absorbCompleteManualFloors(source: Record<string, AnyNode>) {
  let nodes = source
  const slabs = Object.values(source).filter((node): node is SlabNode => node.type === 'slab')
  for (const slab of slabs) {
    if (
      slab.autoFromWalls ||
      slab.boundary === 'auto' ||
      slab.plateRole ||
      slab.support === 'open' ||
      slab.recessed ||
      slab.visible === false ||
      (slab.metadata?.plateMigration as { demoted?: string } | undefined)?.demoted !== undefined ||
      !slab.parentId
    )
      continue
    const rooms = Object.values(source).filter(
      (node): node is ZoneNode =>
        node.type === 'zone' &&
        node.parentId === slab.parentId &&
        node.spaceRole === 'room' &&
        node.floor?.sourceSlabId === slab.id,
    )
    if (!rooms.length || rooms.length !== slab.associatedZoneIds?.length) continue
    const levelSlabs = slabs.filter((other) => other.parentId === slab.parentId)
    const levelRooms = Object.values(source).filter(
      (node): node is ZoneNode =>
        node.type === 'zone' && node.parentId === slab.parentId && node.spaceRole === 'room',
    )
    const completeLevel =
      levelRooms.length > 0 &&
      levelSlabs.every(
        (other) =>
          !other.autoFromWalls &&
          other.boundary !== 'auto' &&
          !other.plateRole &&
          !other.recessed &&
          Math.abs(other.elevation - slab.elevation) <= 1e-6 &&
          Math.abs(other.thickness - slab.thickness) <= 1e-6 &&
          levelRooms.some((room) => room.floor?.sourceSlabId === other.id),
      ) &&
      levelRooms.every((room) => levelSlabs.some((other) => room.floor?.sourceSlabId === other.id))
    if (!completeLevel) continue
    if (
      rooms.some(
        (room) =>
          room.floor?.elevation !== undefined &&
          Math.abs(room.floor.elevation - slab.elevation) > 0.02 + 1e-9,
      ) ||
      slabs.some(
        (other) =>
          other.id !== slab.id &&
          other.parentId === slab.parentId &&
          area(intersection(slabFootprint(other), slabFootprint(slab))) > 1e-4,
      )
    )
      continue
    const footprint = union(rooms.map(slabFootprint))
    const outside = { outer: slab.polygon, holes: [] }
    const tolerance = Math.max(1e-4, area([outside]) * 1e-4)
    try {
      if (
        area(difference(outside, footprint, { throwOnError: true })) > tolerance ||
        area(difference(footprint, outside, { throwOnError: true })) > tolerance
      )
        continue
    } catch {
      continue
    }
    if (nodes === source) nodes = { ...source }
    nodes[slab.id] = {
      ...parseSlabConstruction(slab),
      boundary: 'auto',
      plateRole: 'base',
      autoFromWalls: true,
      zoneIds: rooms.map((room) => room.id).sort(),
      associatedZoneIds: undefined,
      referenceFloorElevation: slab.elevation,
      foundation: slab.fillToTerrain ? { type: 'solid' } : { type: 'none' },
      fillToTerrain: undefined,
    }
    for (const room of rooms) {
      const { sourceSlabId: _sourceSlabId, ...floor } = room.floor ?? {}
      nodes[room.id] = {
        ...room,
        floor: {
          ...floor,
          elevation: floor.elevation ?? slab.elevation,
          finish: floor.finish ?? slab.slots?.surface ?? slab.material ?? slab.materialPreset,
        },
      }
    }
  }
  return nodes
}

function clearDanglingFloorSources(nodes: Record<string, AnyNode>) {
  let changed = false
  for (const zone of Object.values(nodes)) {
    if (zone.type !== 'zone' || !zone.floor?.sourceSlabId) continue
    if (nodes[zone.floor.sourceSlabId]?.type === 'slab') continue
    const { sourceSlabId: _missing, ...floor } = zone.floor
    nodes[zone.id] = { ...zone, floor }
    changed = true
  }
  return changed
}

/** A level whose hand-drawn floor pieces cannot be adopted exactly: migrate it without them. */
class AdoptionRejected extends Error {}

function migrateFloorPlatesOnView(sourceNodes: Record<string, unknown>) {
  // Adoption is all-or-nothing per level: a level whose pieces are not all
  // consumed migrates exactly as it would without adoption.
  const skip = new Set<string>()
  for (;;) {
    const adoption = planFloorPieceAdoption(sourceNodes as Record<string, AnyNode>, skip)
    const result = runFloorPlateMigration(sourceNodes, adoption)
    const failed = [...adoption.levels.keys()].filter((levelId) =>
      [...adoption.pieces].some(
        ([id, level]) =>
          level === levelId &&
          (result.nodes[id] as SlabNode | undefined)?.type === 'slab' &&
          !(result.nodes[id] as SlabNode).plateRole,
      ),
    )
    if (!failed.length) return result
    for (const levelId of failed) skip.add(levelId)
  }
}

function runFloorPlateMigration(
  sourceNodes: Record<string, unknown>,
  adoption: FloorPieceAdoption,
) {
  const slotMigration = migrateSlabSlots(sourceNodes)
  const nodes = { ...slotMigration.nodes } as Record<string, AnyNode>
  for (const id of adoption.pieces.keys())
    nodes[id] = { ...(nodes[id] as SlabNode), autoFromWalls: true }
  const plateIds: string[] = []
  const reports: FloorPlateMigrationReport[] = []
  const remap = new Map<string, string | undefined>()
  let changed = slotMigration.changed
  if (clearDanglingFloorSources(nodes)) changed = true
  for (const level of Object.values(nodes)) {
    if (level.type !== 'level' || !level.metadata?.legacyRoomMigrationPending) continue
    if (Object.values(nodes).some((node) => node.type === 'slab' && node.parentId === level.id))
      continue
    for (const zone of Object.values(nodes)) {
      if (zone.type !== 'zone' || zone.parentId !== level.id || zone.hasFloor !== undefined)
        continue
      nodes[zone.id] = { ...zone, hasFloor: false }
      changed = true
    }
  }
  for (const source of Object.values(nodes)) {
    if (source.type !== 'slab' || !Object.hasOwn(source, 'legacyFloor')) continue
    const { legacyFloor, ...plate } = source as typeof source & { legacyFloor?: number }
    nodes[source.id] = {
      ...plate,
      referenceFloorElevation: plate.referenceFloorElevation ?? legacyFloor,
    } as SlabNode
    changed = true
  }
  if (
    Object.values(nodes).some((node) => node.type === 'slab' && !node.plateRole) &&
    !Object.values(nodes).some((node) => node.type === 'slab' && node.plateRole)
  ) {
    const converted = convertLegacyFinishSlabs(nodes)
    if (converted !== nodes) {
      Object.assign(nodes, converted)
      for (const id of Object.keys(nodes)) if (!(id in converted)) delete nodes[id]
      changed = true
    }
    // Adopted pieces are still hand-drawn history: they neither mark legacy
    // wall-generated openings nor hold back the level's finalisation.
    const history = adoption.pieces.size
      ? Object.fromEntries(
          Object.entries(nodes).map(([id, node]) => [
            id,
            adoption.pieces.has(id) ? { ...(node as SlabNode), autoFromWalls: false } : node,
          ]),
        )
      : nodes
    const associated = associateLegacyManualFloors(
      nodes,
      history,
      !Object.values(nodes).some(
        (node) =>
          node.type === 'slab' &&
          node.autoFromWalls &&
          !node.plateRole &&
          !adoption.pieces.has(node.id),
      ),
    )
    if (associated !== nodes) {
      Object.assign(nodes, associated)
      changed = true
    }
    const absorbed = absorbCompleteManualFloors(nodes)
    if (absorbed !== nodes) {
      Object.assign(nodes, absorbed)
      changed = true
    }
  }
  for (const level of Object.values(nodes)) {
    if (level.type !== 'level' || !Object.hasOwn(level, 'floorElevation')) continue
    const { floorElevation, ...clean } = level as typeof level & { floorElevation?: number }
    nodes[level.id] = clean
    for (const plate of Object.values(nodes))
      if (
        plate.type === 'slab' &&
        plate.parentId === level.id &&
        (plate.plateRole === 'base' ||
          (!plate.plateRole &&
            plate.support !== 'open' &&
            (plate.autoFromWalls || plate.boundary === 'auto')))
      )
        nodes[plate.id] = { ...plate, floorHeight: floorElevation ?? plate.floorHeight }
    changed = true
  }
  for (const plate of Object.values(nodes)) {
    if (plate.type !== 'slab' || plate.plateRole !== 'base') continue
    if (!plate.foundation || Object.hasOwn(plate, 'fillToTerrain')) {
      const { fillToTerrain, ...clean } = plate
      nodes[plate.id] = {
        ...clean,
        foundation: plate.foundation ?? {
          type: fillToTerrain ? 'solid' : 'none',
          ...(fillToTerrain
            ? { material: plate.slots?.edge ?? plate.slots?.side ?? '#cccccc' }
            : {}),
        },
      } as SlabNode
      changed = true
    }
  }
  for (const plate of Object.values(nodes)) {
    if (plate.type !== 'slab' || plate.support !== 'open' || plate.boundary !== 'auto') continue
    for (const id of plate.zoneIds ?? []) {
      const zone = nodes[id]
      if (zone?.type !== 'zone') continue
      const floorEdgeFinish = zone.floorEdgeFinish ?? plate.slots?.edge
      const finish =
        zone.floor?.finish ?? plate.slots?.surface ?? plate.material ?? plate.materialPreset
      if (floorEdgeFinish === zone.floorEdgeFinish && finish === zone.floor?.finish) continue
      nodes[id] = {
        ...zone,
        ...(floorEdgeFinish === undefined ? {} : { floorEdgeFinish }),
        ...(finish === undefined ? {} : { floor: { ...zone.floor, finish } }),
      }
      changed = true
    }
  }
  for (const level of Object.values(nodes)
    .filter((node) => node.type === 'level')
    .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))) {
    const children = Object.values(nodes)
      .filter((node) => node.parentId === level.id)
      .sort((a, b) => a.id.localeCompare(b.id))
    if (
      !children.some(
        (node) =>
          node.type === 'slab' &&
          (node.autoFromWalls || node.boundary === 'auto') &&
          !node.plateRole &&
          node.support !== 'open',
      )
    )
      continue
    const beforeNodes = { ...nodes }
    const beforeRemap = new Map(remap)
    const beforePlateCount = plateIds.length
    const beforeChanged: boolean = changed
    try {
      const recessed = children.filter(
        (node) => node.type === 'slab' && node.autoFromWalls && !node.boundary && node.recessed,
      )
      if (recessed.length)
        warnPlateFailure(
          level.id,
          recessed.map((node) => node.id),
          'recessed-legacy: preserved verbatim',
        )
      const demotionReasons = new Map<string, string>()
      const demoteUnmatched = (reason?: string) => {
        for (const node of children) {
          if (
            node.type !== 'slab' ||
            (!node.autoFromWalls && node.boundary !== 'auto') ||
            node.recessed ||
            !nodes[node.id] ||
            (nodes[node.id] as SlabNode).plateRole
          )
            continue
          // Unmatched legacy geometry is authored construction, not a room generator.
          nodes[node.id] = {
            ...nodes[node.id],
            autoFromWalls: false,
            boundary: undefined,
            metadata: {
              ...node.metadata,
              plateMigration: {
                demoted:
                  demotionReasons.get(node.id) === 'has-floor-disabled'
                    ? 'has-floor-disabled'
                    : (reason ?? demotionReasons.get(node.id)!),
              },
            },
          } as SlabNode
          changed = true
        }
      }
      const adopted = adoption.levels.get(level.id)
      const reject = () => {
        if (adopted) throw new AdoptionRejected()
      }
      const legacy = children
        .filter(
          (node): node is SlabNode =>
            node.type === 'slab' &&
            (node.autoFromWalls || node.boundary === 'auto') &&
            !node.plateRole &&
            node.support !== 'open' &&
            !node.recessed,
        )
        .map((node) => parseSlabConstruction(node))
      if (!legacy.length) continue
      const walls = children.filter((node): node is WallNode => node.type === 'wall')
      const separators = children.filter((node): node is SeparatorNode => node.type === 'separator')
      const zones = children.filter(
        (node): node is ZoneNode =>
          node.type === 'zone' &&
          node.spaceRole === 'room' &&
          node.enclosureStatus !== 'open' &&
          node.floor?.support !== 'open',
      )
      const faces = floorRoomFaces([...walls, ...separators])
      const boundsOf = (ring: Ring) => ({
        minX: Math.min(...ring.map(([x]) => x)),
        maxX: Math.max(...ring.map(([x]) => x)),
        minZ: Math.min(...ring.map(([, z]) => z)),
        maxZ: Math.max(...ring.map(([, z]) => z)),
      })
      const intersectsBounds = (a: ReturnType<typeof boundsOf>, b: ReturnType<typeof boundsOf>) =>
        a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ
      const boundedFaces = faces.map((face) => ({
        face,
        bounds: boundsOf(face.referencePolygon),
      }))
      const boundedLegacy = legacy.map((slab) => ({ slab, bounds: boundsOf(slab.polygon) }))
      const miters = calculateLevelMiters(walls)
      const context = {
        revision: 0,
        walls: new Map(walls.map((wall) => [wall.id, wall])),
        wallFootprints: new Map<string, Ring>(
          walls.map((wall) => [
            wall.id,
            getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
          ]),
        ),
      }
      const allSlabs = children.filter((node): node is SlabNode => node.type === 'slab')
      const manualCoverage = union(
        allSlabs
          .filter((slab) => !slab.autoFromWalls && slab.boundary !== 'auto')
          .map(slabFootprint),
      )
      for (const slab of legacy) {
        const surface = union([slabFootprint(slab)])
        const disabled = zones.some(
          (zone) =>
            zone.hasFloor === false &&
            footprintIoU(slabFootprint(zone), slabFootprint(slab)) >= 0.6,
        )
        demotionReasons.set(
          slab.id,
          disabled
            ? 'has-floor-disabled'
            : area(surface) > 0 &&
                area(intersection(surface, manualCoverage)) >= area(surface) * 0.6
              ? 'manual-coverage'
              : faces.length
                ? walls.some((wall) => wall.curveOffset)
                  ? 'curved-face-mismatch'
                  : 'stale-or-unmatched-straight'
                : 'no-detected-room',
        )
      }
      const linked = new Set(
        allSlabs
          .filter((slab) => slab.boundary === 'auto' && slab.plateRole)
          .flatMap((slab) => slab.zoneIds ?? []),
      )
      const wallArea = union([...context.wallFootprints.values()])
      const renderContext = prepareSlabPolygonContext({ walls, siblingSlabs: allSlabs })
      const renderedSlabs = new Map(
        allSlabs.map((slab) => [slab.id, getRenderableSlabPolygon(slab, renderContext)]),
      )
      const legacySurfaces = new Map(
        legacy.map((slab) => [
          slab.id,
          {
            outer: renderedSlabs.get(slab.id)!,
            holes: [],
          },
        ]),
      )
      const sources = new Map<string, SlabNode>()
      const rooms: PlateRoom[] = []
      for (const zone of zones) {
        if (linked.has(zone.id)) continue
        const zoneFootprint = slabFootprint(zone)
        const zoneBounds = boundsOf(zone.polygon)
        const face = boundedFaces
          .filter((entry) => intersectsBounds(zoneBounds, entry.bounds))
          .map(({ face }) => ({
            face,
            iou: footprintIoU(zoneFootprint, {
              outer: face.referencePolygon,
              holes: face.holes,
            }),
          }))
          .sort((a, b) => b.iou - a.iou)[0]
        if (!face || face.iou < 0.9 || zone.hasFloor === false) continue
        const candidates = boundedLegacy
          .filter((entry) => intersectsBounds(zoneBounds, entry.bounds))
          .map(({ slab }) => ({
            slab,
            overlap: area(intersection(slabFootprint(slab), zoneFootprint)),
            iou: footprintIoU(slabFootprint(slab), zoneFootprint),
          }))
          .filter(({ overlap }) => overlap > 0)
          .sort(
            (a, b) => b.overlap - a.overlap || b.iou - a.iou || a.slab.id.localeCompare(b.slab.id),
          )
        const source = candidates[0]?.slab
        const boundaryWalls = union(
          [...new Set(face.face.spans.map((span) => span.boundaryId))].flatMap((id) =>
            context.wallFootprints.has(id) ? [context.wallFootprints.get(id)!] : [],
          ),
        )
        let clear = union([slabFootprint(zone)])
        try {
          clear = difference(clear, boundaryWalls, { throwOnError: true })
        } catch {
          // If wall subtraction fails, require coverage of the entire reference
          // face instead of treating a clipping failure as an empty room.
        }
        if (!clear.length) continue
        // A stale/sliver slab overlap is not evidence that this whole face had a floor.
        // Subtract only nearby surfaces: unioning every legacy slab can fail on
        // distant self-intersections and incorrectly suppress otherwise valid rooms.
        const uncovered = candidates.reduce((remaining, { slab }) => {
          try {
            return difference(remaining, legacySurfaces.get(slab.id)!, { throwOnError: true })
          } catch {
            return remaining
          }
        }, clear)
        const open = adopted?.voids.length
          ? difference(uncovered, union(adopted.voids.map((ring) => ({ outer: ring, holes: [] }))))
          : uncovered
        if (area(open) > Math.max(1e-6, area(clear) * 0.01)) continue
        const recessed = allSlabs.some(
          (slab) =>
            slab.recessed &&
            area(intersection({ outer: slab.polygon, holes: [] }, clear)) >= area(clear) * 0.6,
        )
        if (recessed) continue
        if (!source) continue
        const floor = { ...zone.floor }
        // Partial cover by a piece is an open void in the plate, not an authored floor.
        if (adopted && legacy.some((slab) => slab.id === floor.sourceSlabId))
          delete floor.sourceSlabId
        const finish = source.slots?.surface ?? source.material ?? source.materialPreset
        if (finish !== undefined && floor.finish === undefined) floor.finish = finish
        // Keep legacy F even when it matches this room's automatic datum:
        // the connected footprint can inherit a higher automatic datum.
        if (floor.elevation === undefined) floor.elevation = source.elevation
        const updated = Object.keys(floor).length ? { ...zone, floor } : zone
        nodes[zone.id] = updated
        sources.set(zone.id, source)
        rooms.push({
          id: zone.id,
          zone: updated,
          polygon: face.face.referencePolygon,
          holes: face.face.holes,
          spans: face.face.spans,
          context,
        })
      }
      if (!rooms.length) {
        reject()
        demoteUnmatched()
        continue
      }
      // Legacy support uses rendered slabs, without the new room-face datums.
      const oldSupports = legacyWallElevations(walls, allSlabs, beforeNodes, level.id)
      const derived = autoRoomVerticalPlacements(rooms, nodes)
      const defaultFloor = derived.size ? Math.max(...derived.values()) : DEFAULT_SLAB_ELEVATION
      const componentFloors = new Map<string, number>()
      const referenceFloors = new Map<string, number>()
      for (const component of plateFootprint(rooms)) {
        const members = rooms.filter(
          (room) => area(intersection(slabFootprint(room), component)) > 0,
        )
        const inherited = members
          .map((room) => sources.get(room.id)?.floorHeight)
          .find((height) => height !== undefined)
        const boundaryIds = new Set(
          members.flatMap((room) => room.spans.map((span) => span.boundaryId)),
        )
        // The footprint keeps the floor height most of its floor area had (on a
        // tie, the one the walls give anyway). The wall-derived datum can differ
        // (a pad under one wall, an authored slab height); re-deriving it sinks
        // the other rooms and lifts walls onto a band with a gap under it.
        const grounded = members.filter((room) => !room.zone.floor?.sourceSlabId)
        const automatic = grounded.length
          ? Math.max(...grounded.map((room) => derived.get(room.zone.id) ?? DEFAULT_SLAB_ELEVATION))
          : undefined
        const candidates = new Map<number, { area: number; thickness: number }>()
        for (const room of grounded) {
          const source = sources.get(room.id)
          if (!source) continue
          const floor = Math.round(source.elevation * 1e6) / 1e6
          const entry = candidates.get(floor) ?? { area: 0, thickness: source.thickness }
          entry.area += area([slabFootprint(room)])
          entry.thickness = Math.max(entry.thickness, source.thickness)
          candidates.set(floor, entry)
        }
        const largest = Math.max(0, ...[...candidates.values()].map((entry) => entry.area))
        const [referenceFloor] =
          [...candidates]
            .filter(([, entry]) => entry.area >= largest * 0.99)
            .sort(
              ([a], [b]) =>
                Math.abs(a - (automatic ?? a)) - Math.abs(b - (automatic ?? b)) || a - b,
            )[0] ?? []
        if (
          inherited === undefined &&
          referenceFloor !== undefined &&
          automatic !== undefined &&
          Math.abs(referenceFloor - automatic) > 0.005
        )
          for (const room of grounded) {
            const source = sources.get(room.id)
            if (source) referenceFloors.set(source.id, referenceFloor)
          }
        const weights = new Map<number, number>()
        for (const wall of walls) {
          if (!boundaryIds.has(wall.id)) continue
          const support = oldSupports.get(wall.id)!
          const elevation = Math.round((support.elevation - (wall.supportOffset ?? 0)) * 1e6) / 1e6
          weights.set(elevation, (weights.get(elevation) ?? 0) + getWallCurveLength(wall))
        }
        const height =
          inherited ??
          [...weights].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ??
          defaultFloor
        for (const room of members) componentFloors.set(room.id, height)
      }
      for (const room of rooms) {
        const levelFloor = componentFloors.get(room.id) ?? defaultFloor
        if (Math.abs((sources.get(room.id)?.elevation ?? levelFloor) - levelFloor) > 0.005)
          reports.push({ code: 'floor-moved', nodeId: room.id })
      }
      const preserveWallSupportedLegacy = () => {
        reject()
        for (const room of rooms) {
          const source = sources.get(room.id)
          if (!source) continue
          const zone = nodes[room.id] as ZoneNode
          nodes[room.id] = { ...zone, floor: { ...zone.floor, sourceSlabId: source.id } }
        }
        demoteUnmatched('wall-supported-floor')
      }
      const supportedSources = new Set(
        [...oldSupports.values()].flatMap((support) =>
          support.electedSlabId ? [support.electedSlabId] : [],
        ),
      )
      if (
        rooms.some(
          (room) =>
            room.zone.autoFromWalls &&
            supportedSources.has(sources.get(room.id)?.id ?? '') &&
            (sources.get(room.id)?.elevation ?? 0) >
              (componentFloors.get(room.id) ?? defaultFloor) + 0.005,
        )
      ) {
        preserveWallSupportedLegacy()
        continue
      }
      const converted = legacy
        .filter((slab) => [...sources.values()].some((source) => source.id === slab.id))
        .map((slab) => ({
          ...slab,
          boundary: 'auto' as const,
          floorHeight: slab.floorHeight,
          referenceFloorElevation: referenceFloors.get(slab.id),
          foundation: slab.foundation ?? {
            type: slab.fillToTerrain ? ('solid' as const) : ('none' as const),
            ...(slab.fillToTerrain
              ? { material: slab.slots?.edge ?? slab.slots?.side ?? '#cccccc' }
              : {}),
          },
          zoneIds: rooms
            .filter((room) => sources.get(room.id)?.id === slab.id)
            .map((room) => room.id),
        }))
      // Finish overlays must be consumed before manual coverage can suppress their room.
      const regions = new Set<string>()
      const sourceCoverage = union(converted.map(slabFootprint))
      for (const node of children) {
        if (node.type !== 'slab' || node.autoFromWalls || node.boundary === 'auto' || node.recessed)
          continue
        const slab = parseSlabConstruction(node)
        const surface = union([slabFootprint(slab)])
        // A manual floor filling an opening in the old construction is structural,
        // not a finish overlay; deleting it would expose that opening.
        if (area(difference(surface, sourceCoverage)) > Math.max(1e-6, area(surface) * 0.01))
          continue
        const room = rooms.find(
          ({ zone }) =>
            Math.abs(slab.elevation - (zone.floor?.elevation ?? DEFAULT_SLAB_ELEVATION)) <=
              0.02 + 1e-9 &&
            area(intersection(surface, slabFootprint(zone))) >= area(surface) * (1 - 1e-3),
        )
        if (!room) continue
        const finish =
          slab.slots?.surface ?? slab.material ?? slab.materialPreset ?? 'library:wood-woodplank48'
        const polygon = slabFootprint(slab)
        const xs = [...new Set(slab.holes.flatMap((hole) => hole.map(([x]) => x)))].sort(
          (a, b) => a - b,
        )
        const minX = Math.min(...slab.polygon.map(([x]) => x))
        const maxX = Math.max(...slab.polygon.map(([x]) => x))
        const minZ = Math.min(...slab.polygon.map(([, z]) => z))
        const maxZ = Math.max(...slab.polygon.map(([, z]) => z))
        const cuts = [...new Set([minX, ...xs, maxX])].sort((a, b) => a - b)
        const regionPolygons = slab.holes.length
          ? cuts.slice(1).flatMap((x, i) =>
              intersection(polygon, [
                [cuts[i]!, minZ],
                [x, minZ],
                [x, maxZ],
                [cuts[i]!, maxZ],
              ] as Ring).map((part) => part.outer),
            )
          : [slab.polygon]
        const zone = nodes[room.id] as ZoneNode
        nodes[zone.id] = {
          ...zone,
          floor: {
            ...zone.floor,
            regions: [
              ...(zone.floor?.regions ?? []),
              ...regionPolygons.map((polygon, i) => ({
                id: i ? `${slab.id}_${i}` : slab.id,
                polygon,
                finish,
              })),
            ],
          },
        }
        regions.add(slab.id)
        remap.set(slab.id, sources.get(room.id)!.id)
      }
      const plan = buildFloorPlates({
        levelId: level.id,
        nodes: Object.fromEntries(Object.entries(nodes).filter(([id]) => !regions.has(id))),
        rooms,
        slabs: [
          ...converted,
          ...children
            .filter(
              (node): node is SlabNode =>
                node.type === 'slab' &&
                !node.autoFromWalls &&
                node.boundary !== 'auto' &&
                !regions.has(node.id),
            )
            .map((slab) => parseSlabConstruction(slab)),
        ],
        mintId: (ids, component, role) => floorPlateId(level.id, role ?? 'base', ids, component),
        renderedManualCuts: false,
      })
      for (const source of converted) {
        for (const [index, hole] of (source.holes ?? []).entries()) {
          const holeArea = area([{ outer: hole, holes: [] }])
          if (holeArea < 1e-4) continue
          const plateIndex = plan.plates.findIndex(
            (plate) =>
              Math.abs(plate.elevation - source.elevation) <= 1e-6 &&
              area(intersection(hole, slabFootprint(plate))) >= holeArea - 1e-4,
          )
          if (plateIndex < 0) continue
          const plate = plan.plates[plateIndex]!
          if (
            plate.holes.some(
              (existing) =>
                area(intersection(existing, hole)) >= holeArea - 1e-4 &&
                Math.abs(area([{ outer: existing, holes: [] }]) - holeArea) <= 1e-4,
            )
          )
            continue
          plan.plates[plateIndex] = {
            ...plate,
            holes: [...plate.holes, hole],
            holeMetadata: [
              ...plate.holeMetadata,
              source.holeMetadata?.[index] ?? { source: 'manual' },
            ],
          }
        }
      }
      const expandsLegacySource = plan.plates.some((plate) => {
        const source = legacySurfaces.get(plate.id)
        if (!source) return false
        const added = area(difference(slabFootprint(plate), [source]))
        return area([source]) < 5 && added > Math.max(10, area([source]) * 5)
      })
      if (expandsLegacySource) {
        reject()
        demoteUnmatched('excess-plate-extent')
        continue
      }
      const retained = allSlabs.filter(
        (slab) => !legacy.some((source) => source.id === slab.id) && !regions.has(slab.id),
      )
      const retainedConstruction = retained.filter(
        (slab) => slab.visible !== false && slab.support !== 'open' && !slab.recessed,
      )
      if (retainedConstruction.length) {
        const retainedFootprint = union(
          retainedConstruction.map((slab) => ({
            outer: renderedSlabs.get(slab.id)!,
            holes: slab.holes,
          })),
        )
        const oldOverlap = intersection(
          retainedFootprint,
          union(legacy.map((slab) => legacySurfaces.get(slab.id)!)),
        )
        const newOverlap = intersection(retainedFootprint, union(plan.plates.map(slabFootprint)))
        if (area(difference(newOverlap, oldOverlap)) > 1e-4) {
          preserveWallSupportedLegacy()
          continue
        }
        const nextRenderContext = prepareSlabPolygonContext({
          walls,
          siblingSlabs: [...retained, ...plan.plates],
        })
        if (
          retainedConstruction.some((slab) => {
            if (slab.boundary === 'auto') return false
            const before = renderedSlabs.get(slab.id)!
            const after = getRenderableSlabPolygon(slab, nextRenderContext)
            return area(difference(before, after)) + area(difference(after, before)) > 1e-4
          })
        ) {
          preserveWallSupportedLegacy()
          continue
        }
      }
      const wallSupports = new Set(
        [...oldSupports.values()].flatMap((support) =>
          support.electedSlabId ? [support.electedSlabId] : [],
        ),
      )
      if (
        rooms.some((room) => room.zone.autoFromWalls) &&
        (plan.plates.some(
          (plate) =>
            plate.plateRole !== 'base' &&
            wallSupports.has(plate.id) &&
            legacy.some((source) => source.id === plate.id),
        ) ||
          walls.some((wall) => {
            const sourceId = oldSupports.get(wall.id)?.electedSlabId
            if (!sourceId || !legacy.some((source) => source.id === sourceId)) return false
            const next = plan.plates.find((plate) => plate.id === sourceId)
            return next !== undefined && !wallOverlapsSlabFootprint(wall, next.polygon, next.holes)
          }))
      ) {
        preserveWallSupportedLegacy()
        continue
      }
      const nextSlabs = [...retained, ...plan.plates]
      const visibleTops = (slabs: SlabNode[]) =>
        new Set(
          slabs
            .filter((slab) => slab.visible !== false && slab.support !== 'open' && !slab.recessed)
            .map((slab) => Math.round(slab.elevation * 1000)),
        )
      const oldTops = visibleTops(allSlabs)
      const newTops = visibleTops(nextSlabs)
      const sameSingleTop =
        oldTops.size === 1 &&
        newTops.size === 1 &&
        Math.abs([...oldTops][0]! - [...newTops][0]!) <= 20
      if (
        !sameSingleTop &&
        visibleFloorTopChange(allSlabs, nextSlabs, [...context.wallFootprints.values()]) > 0.05
      ) {
        for (const room of rooms) {
          const source = sources.get(room.id)
          if (!source) continue
          const zone = nodes[room.id] as ZoneNode
          nodes[room.id] = { ...zone, floor: { ...zone.floor, sourceSlabId: source.id } }
        }
        reject()
        demoteUnmatched('visible-floor-top')
        continue
      }
      const oldFloor = union(
        allSlabs.map((slab) => ({
          outer: renderedSlabs.get(slab.id)!,
          holes: slab.holes ?? [],
        })),
      )
      const nextFloor = () =>
        union([
          ...retained.map((slab) => ({
            outer: renderedSlabs.get(slab.id)!,
            holes: slab.holes ?? [],
          })),
          ...plan.plates.map(slabFootprint),
        ])
      // A hidden wall hides no floor: pieces are compared on what is seen.
      const seenWalls = adopted
        ? union(
            walls
              .filter((wall) => wall.visible !== false)
              .map((wall) => ({ outer: context.wallFootprints.get(wall.id)!, holes: [] })),
          )
        : wallArea
      const visibleBefore = difference(oldFloor, seenWalls)
      let visibleAfter = difference(nextFloor(), seenWalls)
      // Hand-drawn pieces: floor the plate would add stays open (a hole) unless
      // it is a narrow drawing gap; floor it drops must be a thin strip drawn
      // past the walls, outside every room.
      let trimmed: MultiPolygon = []
      let voidHoles = 0
      // No measurable old floor (invalid piece geometry): nothing proves the plate matches it.
      if (adopted && !oldFloor.length) reject()
      if (adopted) {
        for (const part of difference(visibleAfter, visibleBefore)) {
          if (area([part]) <= 1e-4 || partWidth(part) <= PIECE_GAP_WIDTH + 1e-9) continue
          const plate = plan.plates.find(
            (candidate) =>
              candidate.plateRole === 'base' &&
              area(difference(part, slabFootprint(candidate))) <= 1e-6,
          )
          // A hole survives re-derivation; a notch in the plate's outline would not.
          if (
            !plate ||
            part.holes.length ||
            part.outer.some(
              (point) => distanceToBoundary([{ outer: plate.polygon, holes: [] }], point) <= 1e-3,
            )
          )
            reject()
          plate!.holes = [...plate!.holes, part.outer]
          plate!.holeMetadata = [...plate!.holeMetadata, { source: 'manual' }]
          voidHoles++
        }
        visibleAfter = difference(nextFloor(), seenWalls)
        const kept = union([...visibleAfter, ...seenWalls])
        const roomArea = union(zones.map(slabFootprint))
        trimmed = difference(visibleBefore, visibleAfter).filter((part) => area([part]) > 1e-6)
        for (const part of trimmed)
          if (
            area(intersection(part, roomArea)) > 1e-4 ||
            partWidth(part) > PIECE_TRIM_DEPTH ||
            part.outer.some(
              (point) =>
                !containsPoint(kept, point) &&
                distanceToBoundary(kept, point) > PIECE_TRIM_DEPTH + 1e-6,
            )
          )
            reject()
        if (
          area(difference(visibleAfter, visibleBefore)) > Math.max(1e-4, area(visibleBefore) * 0.02)
        )
          reject()
      } else if (
        oldFloor.length &&
        (area(difference(visibleAfter, visibleBefore)) > 1e-4 ||
          area(difference(visibleBefore, visibleAfter)) > 1e-4)
      ) {
        preserveWallSupportedLegacy()
        continue
      }
      for (const [component, plate] of plan.plates.entries()) {
        const source = converted.find((source) => source.id === plate.id)
        if (!source) continue
        let preservesSource = false
        try {
          const original = difference(slabFootprint(source), [], { throwOnError: true })
          const visibleSource = difference(
            { ...legacySurfaces.get(source.id)!, holes: source.holes },
            wallArea,
            { throwOnError: true },
          )
          preservesSource = [original, visibleSource].every(
            (surface) =>
              area(
                difference(surface, union(plan.plates.map(slabFootprint)), { throwOnError: true }),
              ) <= Math.max(1e-6, area(surface) * 0.01),
          )
        } catch {
          demotionReasons.set(source.id, 'coverage-error')
        }
        if (!preservesSource) {
          const id = floorPlateId(
            level.id,
            plate.plateRole ?? 'open',
            plate.zoneIds ?? [],
            component,
          )
          plan.remap.set(source.id, id)
          plate.id = id as SlabNode['id']
        }
      }
      const generated = new Map<string, string>()
      for (const plate of plan.plates) {
        const id = plate.id
        const majority = converted
          .map((source) => ({
            source,
            area: area(intersection(slabFootprint(source), slabFootprint(plate))),
          }))
          .sort((a, b) => b.area - a.area || a.source.id.localeCompare(b.source.id))[0]?.source
        // An unfinished piece showed the default slab top; its room must not
        // inherit another piece's finish through the plate's own surface.
        const surface =
          adopted &&
          rooms.some(
            (room) =>
              plate.zoneIds?.includes(room.id as ZoneNode['id']) &&
              (nodes[room.id] as ZoneNode).floor?.finish === undefined,
          )
            ? undefined
            : majority
        const slots = { ...plate.slots }
        delete slots.surface
        if (surface?.slots?.surface) slots.surface = surface.slots.surface
        nodes[id] = {
          ...plate,
          id,
          // A hand-drawn floor's top was authored, not derived from support.
          ...(plate.plateRole === 'base' &&
          plate.referenceFloorElevation === undefined &&
          (adopted || Math.abs(plate.elevation - DEFAULT_SLAB_ELEVATION) > 0.02)
            ? { referenceFloorElevation: plate.elevation }
            : {}),
          slots: plate.plateRole === 'base' || plate.support === 'open' ? slots : undefined,
          material: surface?.material,
          materialPreset: surface?.materialPreset,
        }
        changed = true
        plateIds.push(id)
        generated.set(plate.id, id)
      }
      const partitionContext = {
        walls,
        zones: rooms.map((room) => nodes[room.id] as ZoneNode),
        slabs: plan.plates,
        openings: Object.values(nodes).filter(
          (node): node is import('../schema').DoorNode | import('../schema').WindowNode =>
            node.type === 'door' || node.type === 'window',
        ),
      }
      const needsSidePaint = [...sources.values()].some(
        (source) => source.slots?.riser || source.slots?.edge,
      )
      const migratedSides = needsSidePaint
        ? plan.plates.flatMap(
            (plate) => computePlateSurfacePartition(plate, partitionContext)?.sides ?? [],
          )
        : []
      for (const room of rooms) {
        const source = sources.get(room.id)
        if (!source) continue
        const sides = migratedSides.filter((side) => side.zoneId === room.id)
        const zone = nodes[room.id] as ZoneNode
        nodes[room.id] = {
          ...zone,
          ...(zone.floorStepFinish === undefined &&
          source.slots?.riser &&
          sides.some((s) => s.role === 'riser')
            ? { floorStepFinish: source.slots.riser }
            : {}),
          ...(zone.floorEdgeFinish === undefined &&
          source.slots?.edge &&
          sides.some((s) => s.role === 'edge')
            ? { floorEdgeFinish: source.slots.edge }
            : {}),
        }
      }
      for (const source of converted) {
        if (plan.plates.some((plate) => plate.id === source.id)) continue
        const replacements = adopted
          ? plan.plates
          : plan.plates.filter((plate) => plate.zoneIds?.some((id) => source.zoneIds.includes(id)))
        const replacementCoverage = union(replacements.map(slabFootprint))
        // Stale slabs can extend beyond every current room. Keep that authored
        // surface until its remaining area can be represented, rather than erase it.
        let covered = false
        let reason = replacements.length ? 'matched-source-residual' : 'manual-coverage'
        try {
          const original = difference(slabFootprint(source), [], { throwOnError: true })
          const visibleSource = difference(
            { ...legacySurfaces.get(source.id)!, holes: source.holes },
            wallArea,
            { throwOnError: true },
          )
          covered = adopted
            ? area(difference(difference(visibleSource, replacementCoverage), trimmed)) <= 1e-4
            : [original, visibleSource].every(
                (surface) =>
                  area(difference(surface, replacementCoverage, { throwOnError: true })) <=
                  Math.max(1e-6, area(surface) * 0.01),
              )
        } catch {
          // A failed coverage calculation cannot justify deleting stored construction.
          reason = 'coverage-error'
        }
        if (!covered) {
          demotionReasons.set(source.id, reason)
          continue
        }
        const target = generated.get(source.id) ?? generated.get(plan.remap.get(source.id) ?? '')
        remap.set(source.id, target)
        delete nodes[source.id]
        changed = true
      }
      if (adopted) {
        const cover = union(plan.plates.map(slabFootprint))
        for (const [id, levelId] of adoption.pieces) {
          if (levelId !== level.id || !nodes[id] || generated.has(id)) continue
          // A piece no room took as its source (a finish laid on another piece).
          const surface = difference(
            { outer: renderedSlabs.get(id as SlabNode['id'])!, holes: [] },
            wallArea,
          )
          if (area(difference(difference(surface, cover), trimmed)) > 1e-4) reject()
          const [target] = plan.plates
            .map((plate) => ({ plate, overlap: area(intersection(surface, slabFootprint(plate))) }))
            .sort((a, b) => b.overlap - a.overlap || a.plate.id.localeCompare(b.plate.id))
          remap.set(id, target?.plate.id)
          delete nodes[id]
          changed = true
        }
        const finishOf = (slab: SlabNode) => JSON.stringify(floorPieceFinish(slab) ?? null)
        for (const room of rooms) {
          const zone = nodes[room.id] as ZoneNode
          const own = JSON.stringify(zone.floor?.finish ?? null)
          const same = union(
            legacy
              .filter((slab) => finishOf(slab) === own)
              .map((slab) => ({ outer: renderedSlabs.get(slab.id)!, holes: [] })),
          )
          const regions = legacy.flatMap((slab) => {
            const finish = floorPieceFinish(slab)
            if (finish === undefined || finishOf(slab) === own) return []
            const parts = difference(
              intersection({ outer: renderedSlabs.get(slab.id)!, holes: [] }, slabFootprint(zone)),
              same,
            ).filter((part) => area([part]) > 0.01 && partWidth(part) > PIECE_GAP_WIDTH)
            return parts.map((part, i) => ({
              id: `${slab.id}_${room.id}${i ? `_${i}` : ''}`,
              polygon: part.outer,
              finish,
            }))
          })
          if (regions.length)
            nodes[room.id] = {
              ...zone,
              floor: { ...zone.floor, regions: [...(zone.floor?.regions ?? []), ...regions] },
            }
        }
        // Every wall-generated slab and piece is consumed, or the level keeps its slabs.
        if (legacy.some((slab) => nodes[slab.id] && !(nodes[slab.id] as SlabNode).plateRole))
          reject()
        reports.push({
          code: 'floor-pieces-absorbed',
          nodeId: level.id,
          pieces: [...adoption.pieces].flatMap(([id, levelId]) =>
            levelId === level.id ? [id] : [],
          ),
          trimmed: Math.round(area(trimmed) * 1e4) / 1e4,
          closed: Math.round(area(difference(visibleAfter, visibleBefore)) * 1e4) / 1e4,
          holes: voidHoles,
        })
      }
      demoteUnmatched()
      for (const id of regions) delete nodes[id]
      const newSupportNodes = { ...nodes }
      for (const wall of walls) {
        const old = oldSupports.get(wall.id)!
        const next = wallSupportForNodes(wall, newSupportNodes)
        const oldTop =
          wall.height === undefined
            ? getStoredLevelHeight(level)
            : (wall.supportSlabId === 'ground' ? old.elevation : Math.max(0, old.elevation)) +
              wall.height
        const newTop = resolveWallTop(wall, getStoredLevelHeight(level), next.elevation)
        if (wall.height !== undefined && Math.abs(oldTop - newTop) > 0.001)
          nodes[wall.id] = { ...wall, height: oldTop - next.elevation }
        for (const id of wall.children ?? []) {
          const opening = nodes[id]
          if (
            (opening?.type !== 'door' && opening?.type !== 'window') ||
            isFloorAnchoredOpening(opening)
          )
            continue
          const delta = old.elevation - getOpeningFloorDatum(wall, opening, newSupportNodes)
          if (Math.abs(delta) > 1e-6)
            nodes[id] = {
              ...opening,
              ...(opening.position[1] + delta - opening.height / 2 <= 0.01
                ? { verticalAnchor: 'wall' as const }
                : {}),
              position: [
                opening.position[0],
                Math.round((opening.position[1] + delta) * 1e6) / 1e6,
                opening.position[2],
              ],
            }
        }
        const delta = old.elevation - next.elevation
        if (wall.faceRegions?.length && Math.abs(delta) > 1e-6)
          nodes[wall.id] = {
            ...nodes[wall.id],
            faceRegions: wall.faceRegions.map((region) => ({
              ...region,
              ...(region.v0 === undefined
                ? {}
                : { v0: Math.round((region.v0 + delta) * 1e6) / 1e6 }),
              ...(region.v1 === undefined
                ? {}
                : { v1: Math.round((region.v1 + delta) * 1e6) / 1e6 }),
            })),
          } as WallNode
      }
      if (level.type === 'level')
        nodes[level.id] = {
          ...level,
          children: [
            ...level.children.filter((id) => !!nodes[id]),
            ...[...generated.values()].filter((id) => !level.children.includes(id as never)),
          ] as typeof level.children,
        }
    } catch (error) {
      const rejected = error instanceof AdoptionRejected
      for (const id of Object.keys(nodes)) delete nodes[id]
      Object.assign(nodes, beforeNodes)
      remap.clear()
      for (const [id, target] of beforeRemap) remap.set(id, target)
      plateIds.length = beforePlateCount
      changed = beforeChanged
      if (!rejected)
        warnPlateFailure(
          level.id,
          Object.values(beforeNodes)
            .filter((node) => node.parentId === level.id)
            .map((node) => node.id),
          error,
        )
    }
  }
  for (const node of Object.values(nodes)) {
    const data = { ...node } as AnyNode & { supportSlabId?: string; deckSlabId?: string }
    let changed = false
    for (const field of ['supportSlabId', 'deckSlabId'] as const) {
      let host = data[field]
      const seen = new Set<string>()
      while (host && remap.has(host) && !seen.has(host)) {
        seen.add(host)
        host = remap.get(host)
      }
      if (host !== data[field]) {
        data[field] = replacementPlateFor(
          node,
          field,
          Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab'),
          { ...sourceNodes, ...nodes } as Record<string, AnyNode>,
        )
        changed = true
      }
    }
    if (changed) nodes[node.id] = data as AnyNode
  }
  if (
    Object.values(sourceNodes).some(
      (node) =>
        (node as SlabNode).type === 'slab' &&
        ((node as SlabNode).autoFromWalls || (node as SlabNode).boundary === 'auto') &&
        !(node as SlabNode).plateRole,
    )
  ) {
    const associated = associateLegacyManualFloors(nodes, sourceNodes as Record<string, AnyNode>)
    if (associated !== nodes) {
      Object.assign(nodes, associated)
      changed = true
    }
  }
  if (!Object.values(sourceNodes).some((node) => (node as SlabNode).plateRole)) {
    const absorbed = absorbCompleteManualFloors(nodes)
    if (absorbed !== nodes) {
      Object.assign(nodes, absorbed)
      changed = true
    }
  }
  if (clearDanglingFloorSources(nodes)) changed = true
  if (changed)
    for (const [id, node] of Object.entries(nodes))
      if (node !== sourceNodes[id]) nodes[id] = omitUndefined(node)
  const visibleFinishes = new Set(
    Object.values(nodes)
      .flatMap((node) => {
        if (node.type === 'zone')
          return [
            node.floor?.finish,
            node.floorStepFinish,
            node.floorEdgeFinish,
            ...(node.floor?.regions ?? []).map((region) => region.finish),
          ]
        if (node.type === 'slab')
          return [node.material, node.materialPreset, ...Object.values(node.slots ?? {})]
        return []
      })
      .filter((value) => value !== undefined)
      .map((value) => JSON.stringify(value)),
  )
  for (const source of Object.values(sourceNodes) as AnyNode[])
    if (
      source.type === 'slab' &&
      (source.autoFromWalls || source.boundary === 'auto') &&
      !source.plateRole
    ) {
      for (const finish of new Set(
        [source.material, source.materialPreset, ...Object.values(source.slots ?? {})].filter(
          (value) => value !== undefined,
        ),
      ))
        if (!visibleFinishes.has(JSON.stringify(finish)))
          reports.push({ code: 'finish-not-visible', nodeId: source.id, finish })
    }
  return { nodes: changed ? nodes : sourceNodes, plateIds, reports }
}

function migrateSlabSlotsOnView(sourceNodes: Record<string, unknown>) {
  const nodes = { ...sourceNodes } as Record<string, AnyNode>
  let changed = false
  for (const node of Object.values(nodes)) {
    if (node.type !== 'slab' || !node.slots?.side) continue
    if (['edge', 'riser', 'underside'].every((key) => node.slots![key] !== undefined)) continue
    const slots = { ...node.slots }
    for (const key of ['edge', 'riser', 'underside'])
      if (slots[key] === undefined) slots[key] = slots.side!
    nodes[node.id] = omitUndefined({ ...node, slots })
    changed = true
  }
  return { nodes: changed ? nodes : sourceNodes, changed }
}

export const migrateFloorPlates = loadMigration(
  'floor plates',
  migrateFloorPlatesOnView,
  (nodes) => ({ nodes, plateIds: [], reports: [] }),
)

export const migrateSlabSlots = loadMigration('slab slots', migrateSlabSlotsOnView, (nodes) => ({
  nodes,
  changed: false,
}))
