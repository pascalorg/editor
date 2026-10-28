import { setFloorFoundation } from '../commands/structure/set-floor-foundation'
import {
  type BuildingFoundationRecord,
  type BuildingFoundationType,
  buildingFoundationRecordOf,
  buildingStoreyCount,
  resolveBuildingFoundation,
} from '../lib/building-foundation'
import {
  automaticFloorHeight,
  floorPlateAtGroundContact,
  groundFloorConstruction,
} from '../lib/floor-foundation-datum'
import { designedFoundationReport } from '../lib/generic-foundation'
import { isSiteFlatwork } from '../lib/site-flatwork'
import { slabRoomDoorChanges, slabRoomElevation } from '../lib/slab-room'
import type { AnyNode, AnyNodeId, BuildingNode, SlabNode } from '../schema'
import { getLevelElevations, levelFloorWorldY } from '../services/storey'

const INCH = 0.0254
const round = (value: number) => Math.round(value * 1e6) / 1e6

/**
 * The Foundation panel's change: `patch` merged into the building's foundation record, the finish
 * floor never under the least its type allows (a floor at that least moves with it), and, with
 * the record on, the building seated so its floor top stands `ffAboveGradeIn` over the highest
 * grade under its exterior walls (the stem wall grows down the slope from there); over a basement,
 * so the basement walls' top stands `basementTopAboveGradeIn` over it (`designedBasement`). The
 * designed foundation replaces the plates' own: a ground floor raised on one comes down onto the
 * ground first. Flatwork on its levels (a driveway, a walk) stays on the ground. One change set,
 * one undo step. `null` for an id that is no building.
 */
export function buildBuildingFoundationChanges({
  nodes,
  buildingId,
  patch,
}: {
  nodes: Record<AnyNodeId, AnyNode>
  buildingId: string
  patch: BuildingFoundationRecord
}) {
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building') return null
  const stored = buildingFoundationRecordOf(building)
  const storeys = buildingStoreyCount(nodes, buildingId)
  const merged: BuildingFoundationRecord = { ...stored, ...patch }
  // A floor at its type's least follows that least (a new type, the stem top or the framing
  // moved, up or down); a floor set higher stays where it was set.
  const before = resolveBuildingFoundation(stored, storeys)
  if (patch.ffAboveGradeIn === undefined && before.ffAboveGradeIn - before.ffMinIn < 1e-6)
    delete merged.ffAboveGradeIn
  const resolved = resolveBuildingFoundation(merged, storeys)
  const record: BuildingFoundationRecord = {
    ...merged,
    type: resolved.type,
    ffAboveGradeIn: resolved.ffAboveGradeIn,
  }
  const metadata = { ...(building.metadata ?? {}), foundation: record }
  const recorded = {
    ...nodes,
    [building.id]: { ...building, metadata },
  } as Record<AnyNodeId, AnyNode>
  // A house over a basement is seated whenever its record is on, said so or left on by default.
  const seated =
    record.enabled === true ||
    (resolved.enabled && designedFoundationReport(recorded, building.id)?.basement !== undefined)
  const lowered = seated ? lowerOwnFoundations(recorded, building.id) : []
  const written = { ...recorded }
  for (const { id, data } of lowered) written[id] = { ...written[id], ...data } as AnyNode
  const moveBy = seated ? (designedSeatMove(written, building.id) ?? 0) : 0
  const [x, y, z] = (building as BuildingNode).position
  const flatwork = Math.abs(moveBy) > 1e-6 ? flatworkOf(written, building.id) : []
  const moved = {
    ...written,
    [building.id]: { ...written[building.id as AnyNodeId], position: [x, round(y + moveBy), z] },
  } as Record<AnyNodeId, AnyNode>
  const rooms = slabRoomChanges(moved, building.id, before.type, resolved.type)
  return {
    buildingId: building.id,
    record,
    moveBy,
    update: [
      {
        id: building.id as AnyNodeId,
        data: {
          metadata,
          ...(Math.abs(moveBy) > 1e-6 ? { position: [x, round(y + moveBy), z] } : {}),
        } as Partial<AnyNode>,
      },
      ...lowered.filter((change) => !flatwork.some((slab) => slab.id === change.id)),
      ...flatwork.map((slab) => ({
        id: slab.id as AnyNodeId,
        data: {
          ...lowered.find((change) => change.id === slab.id)?.data,
          elevation: round((slab as { elevation: number }).elevation - moveBy),
        } as Partial<AnyNode>,
      })),
      ...rooms,
    ],
  }
}

/**
 * The building's rooms on a slab of their own (`floor.foundation: 'slab'`, a garage) kept on
 * grade as the house is seated: in a raised house each one's floor at its slab's height over the
 * ground (`slabRoomElevation`, in the scene as seated); a house no longer raised takes them back
 * onto its own floor.
 */
function slabRoomChanges(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
  was: BuildingFoundationType,
  type: BuildingFoundationType,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  if (was !== 'raised' && type !== 'raised') return []
  const elevations = getLevelElevations(nodes)
  const changes: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  for (const zone of Object.values(nodes)) {
    if (zone.type !== 'zone' || zone.floor?.foundation !== 'slab') continue
    if (elevations.get(zone.parentId as AnyNodeId)?.buildingId !== buildingId) continue
    const { elevation: _was, ...floor } = zone.floor
    const elevation = type === 'raised' ? slabRoomElevation(nodes, zone) : null
    if (elevation === (zone.floor.elevation ?? null)) continue
    changes.push({
      id: zone.id as AnyNodeId,
      data: { floor: elevation === null ? floor : { ...floor, elevation } } as Partial<AnyNode>,
    })
    changes.push(...slabRoomDoorChanges(nodes, zone, zone.floor.elevation ?? 0, elevation ?? 0))
  }
  return changes
}

/**
 * How far the building moves to stand on its designed foundation as the record asks: its ground
 * floor's top `ffAboveGradeIn` over the highest grade along the foundation, or over a basement the
 * basement walls' top `basementTopAboveGradeIn` over it (`seatMove`). `null` where no foundation
 * is designed under it (its record off, no closed outline).
 */
export function designedSeatMove(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
): number | null {
  const report = designedFoundationReport(nodes, buildingId)
  if (!report) return null
  const { foundation } = report
  return report.basement
    ? seatMove(
        nodes,
        buildingId,
        (moved) => designedFoundationReport(moved, buildingId)?.basement?.wallTopY ?? null,
        report.highestGradeY + foundation.basementTopAboveGradeIn * INCH,
      )
    : seatMove(
        nodes,
        buildingId,
        (moved) => levelFloorWorldY(moved, report.levelId),
        report.highestGradeY + foundation.ffAboveGradeIn * INCH,
      )
}

/**
 * The changes that move the building `moveBy` metres in height to its seat, its flatwork (a
 * driveway, a walk) staying on the ground. Empty for no move.
 */
export function buildSeatChanges(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
  moveBy: number,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building' || Math.abs(moveBy) <= 1e-6) return []
  const [x, y, z] = building.position
  return [
    { id: building.id as AnyNodeId, data: { position: [x, round(y + moveBy), z] } },
    ...flatworkOf(nodes, buildingId).map((slab) => ({
      id: slab.id as AnyNodeId,
      data: { elevation: round(slab.elevation - moveBy) } as Partial<AnyNode>,
    })),
  ]
}

/** The building's flatwork: slabs on its levels that lie on the ground, not on its foundation. */
function flatworkOf(nodes: Record<AnyNodeId, AnyNode>, buildingId: string): SlabNode[] {
  const elevations = getLevelElevations(nodes)
  return Object.values(nodes).filter(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      isSiteFlatwork(node) &&
      elevations.get(node.parentId as AnyNodeId)?.buildingId === buildingId,
  )
}

/**
 * The changes that bring the ground floor the designed foundation stands under down off its own
 * "raised on a foundation" height, or the seat would lower the house by it and leave the plate's
 * block standing on the designed foundation. Empty where nothing is raised, no foundation is
 * designed (open outside walls), the house stands on a basement, or the floor can't move.
 */
function lowerOwnFoundations(nodes: Record<AnyNodeId, AnyNode>, buildingId: string) {
  const report = designedFoundationReport(nodes, buildingId)
  if (!report || report.basement) return []
  const raised = Object.values(nodes).filter(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      node.plateRole === 'base' &&
      node.parentId === report.levelId &&
      floorPlateAtGroundContact(nodes, node) &&
      groundFloorConstruction(nodes, node).foundationHeight > 0,
  )
  if (!raised.length) return []
  const plan = setFloorFoundation(nodes, {
    slabIds: raised.map((plate) => plate.id),
    patch: { foundationHeight: 0 },
    sameConstruction: true,
  })
  return plan.changes.flatMap((change) =>
    change.op === 'update' ? [{ id: change.id as AnyNodeId, data: change.data }] : [],
  )
}

/**
 * How far the building moves for what `seat` measures (its ground floor's top, a basement's walls'
 * top) to stand at `targetY`. A floor that follows the sculpted ground while its storey stands at
 * the datum stops following it once the move lifts the storey off: the move is measured on the
 * floor as it will stand (each ground plate at its automatic height in the moved scene), or the
 * first seat on a slope buries the house by the rise the floor had taken from the ground.
 */
function seatMove(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
  seat: (moved: Record<AnyNodeId, AnyNode>) => number | null,
  targetY: number,
) {
  const building = nodes[buildingId as AnyNodeId] as BuildingNode
  const [x, y, z] = building.position
  const elevations = getLevelElevations(nodes)
  const plates = Object.values(nodes).filter(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      node.plateRole === 'base' &&
      node.floorHeight === undefined &&
      elevations.get(node.parentId as AnyNodeId)?.buildingId === buildingId,
  )
  let moveBy = 0
  for (let pass = 0; pass < 3; pass++) {
    const moved: Record<AnyNodeId, AnyNode> = {
      ...nodes,
      [building.id]: { ...building, position: [x, y + moveBy, z] },
    }
    for (const plate of plates)
      if (floorPlateAtGroundContact(moved, plate))
        moved[plate.id] = { ...plate, elevation: automaticFloorHeight(moved, plate) }
    const at = seat(moved)
    if (at === null || Math.abs(targetY - at) < 1e-6) break
    moveBy += targetY - at
  }
  return round(moveBy)
}
