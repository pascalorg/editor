import {
  type AnyNode,
  type AnyNodeId,
  acquireSceneHistoryPause,
  applyStructureReconciliation,
  area,
  DEFAULT_FOUNDATION_HEIGHT,
  type FloorFoundationPatch,
  generateId,
  getRoomBaseElevation,
  groundFloorConstruction,
  intersection,
  roomDrawnFloor,
  type SlabNode,
  setFloorFoundation,
  setRoomFloorConstruction,
  upperFloorHeightControl,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { applyRoomPlan } from './room-structure-commands'
import { createSessionWrites } from './session-writes'

// "Floor & foundation": each connected footprint of a level (the house, a
// garden shed…) stands on one base plate. On the ground it is built bottom up:
// the foundation (none, or a height) on the ground, the slab (its thickness)
// on the foundation; the floor top follows from the two. These helpers name a
// footprint and read or write those settings in the words the panel uses.

export type FootprintPreset = 'ground' | 'raised'

/** A footprint raised on a foundation starts with one this high. */
export { DEFAULT_FOUNDATION_HEIGHT }

/** Foundations this low count as on the ground. */
const ON_GROUND = 0.0005

const isBase = (node: AnyNode | undefined): node is SlabNode =>
  node?.type === 'slab' && node.plateRole === 'base'

const footprintArea = (plate: SlabNode) => area([{ outer: plate.polygon, holes: plate.holes }])

/** The level's footprints, largest first (ties by id, so the order is stable). */
export function levelFootprints(nodes: Record<string, AnyNode>, levelId: string): SlabNode[] {
  return Object.values(nodes)
    .filter((node): node is SlabNode => isBase(node) && node.parentId === levelId)
    .sort((a, b) => footprintArea(b) - footprintArea(a) || a.id.localeCompare(b.id))
}

/**
 * The drawn slab a room's floor is: the one it visibly stands on (a legacy
 * floor can show a hand-drawn slab over the one it was taken from), else the
 * one it was taken from, while it still stands on the room's level.
 */
function authoredFloorOwner(nodes: Record<string, AnyNode>, zoneId: string): SlabNode | null {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || !zone.parentId) return null
  const drawn = roomDrawnFloor(nodes, zoneId)
  if (drawn) return nodes[drawn.slabId] as SlabNode
  const source = zone.floor?.sourceSlabId ? nodes[zone.floor.sourceSlabId] : undefined
  return source?.type === 'slab' && source.parentId === zone.parentId ? source : null
}

/**
 * What a room's floor is built as — the same owner core's
 * `setRoomFloorConstruction` edits: the drawn slab the floor came from, else
 * the footprint plate listing the room. Null when the room has none.
 */
export function roomFloorOwner(nodes: Record<string, AnyNode>, zoneId: string): SlabNode | null {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || !zone.parentId) return null
  return (
    authoredFloorOwner(nodes, zoneId) ??
    levelFootprints(nodes, zone.parentId).find((plate) => plate.zoneIds?.includes(zoneId)) ??
    null
  )
}

/**
 * The footprint a room stands on: the one listing it, else the one it
 * overlaps most — unless its floor is a drawn slab, which is its own and not
 * a footprint's (a plate that only brushes it is not where its floor is).
 */
export function roomFootprint(nodes: Record<string, AnyNode>, zoneId: string): SlabNode | null {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || !zone.parentId) return null
  const plates = levelFootprints(nodes, zone.parentId)
  const listed = plates.find((plate) => plate.zoneIds?.includes(zoneId))
  if (listed) return listed
  if (authoredFloorOwner(nodes, zoneId)) return null
  let best: SlabNode | null = null
  let bestOverlap = 0
  for (const plate of plates) {
    const overlap = area(
      intersection(
        { outer: plate.polygon, holes: plate.holes },
        { outer: zone.polygon, holes: zone.holes },
      ),
    )
    if (overlap > bestOverlap) {
      best = plate
      bestOverlap = overlap
    }
  }
  return best
}

/**
 * The floor top an upper footprint rests at by default: mirrors core's
 * `automaticFloorHeight` — its rooms' base heights read with the base plates
 * set aside.
 */
export function groundFloorHeight(nodes: Record<string, AnyNode>, plate: SlabNode): number {
  const withoutBase = Object.fromEntries(Object.entries(nodes).filter(([, node]) => !isBase(node)))
  const heights = (plate.zoneIds ?? []).map((id) => getRoomBaseElevation(withoutBase, id))
  return heights.length ? Math.max(...heights) : 0.05
}

/**
 * How far an upper floor's top is raised above its default position (resting
 * on the walls below), meters; negative when set lower than its default.
 */
export function floorLift(nodes: Record<string, AnyNode>, plate: SlabNode): number {
  return plate.elevation - groundFloorHeight(nodes, plate)
}

/**
 * A ground footprint's foundation height, meters: 0 on the ground. Derived
 * from the floor top, so a legacy slab reaching below the ground reads 0.
 */
export function foundationHeight(nodes: Record<string, AnyNode>, plate: SlabNode): number {
  return groundFloorConstruction(nodes, plate).foundationHeight
}

/** A ground footprint's floor top above the ground: foundation + slab. Read-only. */
export function floorTopAboveGround(nodes: Record<string, AnyNode>, plate: SlabNode): number {
  const { top, grade } = groundFloorConstruction(nodes, plate)
  return Math.round((top - grade) * 1e6) / 1e6
}

/**
 * The one height a footprint's handle and panel field edit. On the ground it
 * is the foundation height (the slab stays on it; the top follows); an upper
 * floor rests on the walls below, so its height is its floor top, and raising
 * it thickens the plate — the underside stays, the storeys above ride up.
 */
export function footprintHeightValue(nodes: Record<string, AnyNode>, plate: SlabNode): number {
  return upperFloorHeightControl(nodes, plate)?.currentTop ?? foundationHeight(nodes, plate)
}

/**
 * The lowest height the handle and field go to: on the ground (no
 * foundation); upstairs, resting on the walls below. An upper floor already
 * lower starts from where it is, so the first drag never jumps.
 */
export function footprintHeightMinimum(nodes: Record<string, AnyNode>, plate: SlabNode): number {
  const upper = upperFloorHeightControl(nodes, plate)
  return upper ? Math.min(upper.currentTop, upper.minimumTop) : 0
}

/** The patch a footprint height writes: upstairs the plate's thickness, on the ground its foundation. */
export function footprintHeightPatch(
  nodes: Record<string, AnyNode>,
  plate: SlabNode,
  value: number,
): FloorFoundationPatch {
  const upper = upperFloorHeightControl(nodes, plate, value)
  return upper
    ? { thickness: upper.write.thickness }
    : { foundationHeight: Math.max(0, Math.round(value * 1e6) / 1e6) }
}

export const THICK_FLOOR_HINT = 'Very thick floor — a mezzanine may fit better.'

/** A plate thick enough that a mezzanine would likely serve better (core's advice; never a refusal). */
export function thickFloorAdvice(nodes: Record<string, AnyNode>, plate: SlabNode, top?: number) {
  return upperFloorHeightControl(nodes, plate, top)?.advice === 'thick-floor'
}

/** On the ground or raised on a foundation: raised exactly when the foundation has a height. */
export function footprintPreset(nodes: Record<string, AnyNode>, plate: SlabNode): FootprintPreset {
  return foundationHeight(nodes, plate) > ON_GROUND ? 'raised' : 'ground'
}

/**
 * The patch a preset choice writes: only the foundation height. Core's
 * `setFloorFoundation` makes the foundation solid while it has a height. Raising
 * keeps a height already set.
 */
export function presetPatch(
  nodes: Record<string, AnyNode>,
  plate: SlabNode,
  preset: FootprintPreset,
): FloorFoundationPatch {
  if (preset === 'ground') return { foundationHeight: 0 }
  const current = foundationHeight(nodes, plate)
  return { foundationHeight: current > ON_GROUND ? current : DEFAULT_FOUNDATION_HEIGHT }
}

/**
 * Writes Floor & foundation settings through core's `setFloorFoundation`: the
 * footprint's floor, walls, openings and room floors move together, in one
 * undo step. Returns why it was refused, or null.
 */
export function applyFloorFoundation(
  slabId: string | readonly string[],
  patch: FloorFoundationPatch,
): string | null {
  const nodes = useScene.getState().nodes
  const plan =
    typeof slabId === 'string'
      ? setFloorFoundation(nodes, { slabId, patch })
      : setFloorFoundation(nodes, { slabIds: [...slabId], patch })
  if (plan.conflicts?.length) return plan.conflicts.map((conflict) => conflict.message).join(' ')
  applyRoomPlan(plan)
  return null
}

/**
 * Edits a room's floor construction through core's `setRoomFloorConstruction`
 * — the one command the room panel and MCP share. It picks the room's floor
 * owner (a drawn slab, or the footprint plate listing the room). A numeric
 * floorHeight moves a drawn slab's top; only a ground footprint has a
 * foundation. Returns why a change was refused, or null.
 */
export function applyRoomFloorConstruction(
  zoneId: string,
  patch: FloorFoundationPatch,
  slabId?: string,
): string | null {
  const plan = setRoomFloorConstruction(useScene.getState().nodes, { zoneId, slabId, patch })
  if (plan.conflicts?.length) return plan.conflicts.map((conflict) => conflict.message).join(' ')
  applyRoomPlan(plan)
  return null
}

const SHARED_STOREY = 'floor-foundation-shared-storey'

/**
 * When a change to one footprint is refused only because an upper floor (or a
 * roof, a ceiling) also stands on other footprints, the footprints that would
 * have to move with it — this one first, so the patch stays its own — if
 * moving them together is accepted. Otherwise null.
 */
export function footprintsToMoveTogether(
  nodes: Record<string, AnyNode>,
  slabId: string,
  patch: FloorFoundationPatch,
): string[] | null {
  const conflicts = setFloorFoundation(nodes, { slabId, patch }).conflicts ?? []
  if (conflicts.length === 0 || conflicts.some((conflict) => conflict.code !== SHARED_STOREY))
    return null
  const ids = new Set([slabId])
  for (const conflict of conflicts)
    for (const id of conflict.nodeIds) if (isBase(nodes[id])) ids.add(id)
  if (ids.size < 2) return null
  const together = setFloorFoundation(nodes, { slabIds: [...ids], patch })
  return together.conflicts?.length ? null : [...ids]
}

/** Sets a footprint's height (`footprintHeightValue`'s terms). */
export function setFootprintHeight(slabId: string, value: number): string | null {
  const plate = useScene.getState().nodes[slabId as AnyNodeId]
  if (!isBase(plate)) return 'The floor is gone.'
  return applyFloorFoundation(slabId, footprintHeightPatch(useScene.getState().nodes, plate, value))
}

type NodeMap = Record<string, AnyNode>

/** Every level of the building a level belongs to (just that level when it has none). */
function buildingLevelIds(nodes: NodeMap, levelId: string | null | undefined): string[] {
  const level = levelId ? nodes[levelId] : undefined
  if (level?.type !== 'level') return []
  const building = level.parentId ? nodes[level.parentId] : undefined
  if (building?.type !== 'building') return [level.id]
  return building.children.filter((id) => nodes[id]?.type === 'level')
}

/**
 * A live height preview (a handle drag, a scrub): each value moves the
 * building outside history; `commit` takes the preview's writes back and
 * writes the final height once — one undo step and one shared change whose
 * "before" is what everyone else has. (Writing the start height back through
 * the command instead is not exact: a foundation finish picked up on the way
 * would stay, and collaborators would refuse the change.)
 */
export function beginFootprintHeightPreview(slabId: string) {
  return beginFootprintPreview(slabId, setFootprintHeight, footprintHeightValue)
}

/** Sets a ground footprint's slab thickness: the top and everything on it follow. */
export function setFootprintThickness(slabId: string, value: number): string | null {
  return applyFloorFoundation(slabId, { thickness: value })
}

/** A live slab-thickness preview (a scrub): the same session as the height's, one undo step. */
export function beginFootprintThicknessPreview(slabId: string) {
  return beginFootprintPreview(slabId, setFootprintThickness, (_, plate) => plate.thickness)
}

function beginFootprintPreview(
  slabId: string,
  write: (slabId: string, value: number) => string | null,
  read: (nodes: Record<string, AnyNode>, plate: SlabNode) => number,
) {
  let writes = createSessionWrites()
  let release: (() => void) | null = null
  const end = () => {
    if (!release) return false
    release()
    release = null
    writes.revert()
    writes = createSessionWrites()
    return true
  }
  return {
    preview(value: number): string | null {
      release ??= acquireSceneHistoryPause(useScene)
      return writes.record(() => {
        const before = useScene.getState().nodes
        const refused = write(slabId, value)
        // Paused writes skip the structure reconciliation a commit runs (the
        // plates' derived heights, the rooms on them); run it here so the
        // building follows the preview.
        // An upper floor's storeys above ride up with it: reconcile the building.
        const levelIds = buildingLevelIds(before, before[slabId as AnyNodeId]?.parentId)
        if (!refused && levelIds.length)
          applyStructureReconciliation(useScene, {
            levelIds,
            previousNodes: before,
            mintId: generateId,
          })
        return refused
      })
    },
    commit(value: number): string | null {
      end()
      const plate = useScene.getState().nodes[slabId as AnyNodeId]
      if (isBase(plate) && Math.abs(read(useScene.getState().nodes, plate) - value) < 1e-6)
        return null
      return write(slabId, value)
    },
    cancel() {
      end()
    },
  }
}

/** Opens a footprint's Floor & foundation panel: its base plate becomes the selection. */
export function openFloorFoundation(slabId: string) {
  useEditor.getState().clearRoom()
  useViewer.getState().setSelection({ selectedIds: [slabId as SlabNode['id']] })
}

/** A base plate's own outside faces: what a click opens Floor & foundation for. */
const FOOTPRINT_ROLES = new Set(['edge', 'foundation', 'side', 'riser', 'underside', 'surface'])

/**
 * Whether a pointer hit is on a footprint's floor edge band or foundation (not
 * a room's floor, step or edge): a click there opens that footprint's Floor &
 * foundation panel rather than the room above it.
 */
export function isFootprintConstructionHit(
  node: AnyNode | undefined,
  object: { userData?: Record<string, unknown> } | null | undefined,
): boolean {
  if (!isBase(node)) return false
  const role = object?.userData?.paintRole
  return typeof role === 'string' && FOOTPRINT_ROLES.has(role)
}

/**
 * Where a click on a room-owned plate lands once it is past the room (the
 * drill click, or Alt): a raised or sunken room's plate is that room's floor,
 * so the drill continues to the footprint floor the room stands on — where a
 * ground-level room's drill lands too. A mezzanine's deck has none (null): it
 * stays on its mezzanine.
 */
export function roomOwnedPlateDrillTarget(
  nodes: Record<string, AnyNode>,
  plate: SlabNode,
): SlabNode | null {
  if (plate.support === 'open') return null
  const zoneId = plate.zoneIds?.[0]
  return zoneId ? roomFootprint(nodes, zoneId) : null
}

/** A raised or sunken room's plate, or a mezzanine's: its room is what gets picked. */
export function isRoomOwnedPlate(node: AnyNode | undefined): boolean {
  return (
    node?.type === 'slab' &&
    (node.plateRole === 'platform' || node.plateRole === 'sunken' || node.support === 'open')
  )
}
