import type { AnyNode, AnyNodeId } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import { boxBodies } from './boxes'
import { fenceBodies } from './fences'
import { levelFloors } from './floors'
import { itemBodies } from './items'
import { openingBodies } from './openings'
import { stairBodies } from './stairs'
import type { LevelShapes, Prism, Skipped, UsageShapes } from './types'
import { levelWalls, type Nodes, wallBodies, wallTrims } from './walls'

export { sdfChecksOn, setSdfChecks } from './flag'
export type { FloorRegion, LevelShapes, Prism, PrismKind, Skipped, UsageShapes } from './types'

/** Kinds that stand in a room and are not shaped yet; counted so a finding can say what it did not see. */
const NOT_SHAPED_YET = ['elevator', 'ramp', 'chimney', 'rock'] as const

const lifted = (prisms: Prism[], dy: number): Prism[] =>
  dy === 0 ? prisms : prisms.map((prism) => ({ ...prism, z0: prism.z0 + dy, z1: prism.z1 + dy }))

/**
 * What a person walks around, level by level, as prisms in the building's frame: plan polygons in
 * metres between two absolute heights. Walls, their trims, door and window frames and sills, stairs
 * and their guards, and the floor itself. A stair is filed under the level it starts from, but its
 * prisms rise through the levels above, so a query reads the prisms of a whole building by height,
 * not one level's list.
 *
 * Items stand on the floor, on the item that hosts them, or on a wall, each as its script's stored
 * outline or a box. Pure: it reads the node record and the helpers the renderers read, and builds no meshes. A node
 * whose shape cannot be read is named in `skipped`; one that is drawn only roughly is named in
 * `approximate`; kinds not shaped yet are counted in `unshaped`.
 */
export function usageShapes(nodes: Nodes): UsageShapes {
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const { floors, skipped: floorSkips } = levelFloors(nodes)
  const skipped: Skipped[] = [...floorSkips]
  const byLevel = new Map<string, LevelShapes>()
  const level = (levelId: string): LevelShapes => {
    let shapes = byLevel.get(levelId)
    if (!shapes) {
      shapes = { levelId, prisms: [], floors: floors.get(levelId) ?? [] }
      byLevel.set(levelId, shapes)
    }
    return shapes
  }
  const levelIds = Object.values(nodes)
    .filter((node) => node.type === 'level')
    .map((node) => node.id)
    .sort()
  for (const levelId of levelIds) {
    const baseY = elevations.get(levelId)?.baseY ?? 0
    const walls = levelWalls(nodes, levelId)
    const trims = wallTrims(nodes, levelId, walls)
    for (const wallId of trims.skipped)
      skipped.push({ nodeId: wallId, why: 'a curved wall: its trim is not drawn here' })
    level(levelId).prisms.push(
      ...lifted(
        [
          ...wallBodies(nodes, levelId, walls),
          ...trims.prisms,
          ...openingBodies(nodes, levelId, walls),
        ],
        baseY,
      ),
    )
  }
  const { stairs, skipped: stairSkips, handrails } = stairBodies(nodes)
  skipped.push(...stairSkips)
  for (const stair of stairs) {
    if (!stair.levelId) {
      skipped.push({ nodeId: stair.stairId, why: 'a stair on no level' })
      continue
    }
    level(stair.levelId).prisms.push(...stair.prisms)
  }
  const items = itemBodies(nodes)
  skipped.push(...items.skipped)
  for (const item of items.items) if (item.levelId) level(item.levelId).prisms.push(...item.prisms)
  const boxes = boxBodies(nodes)
  skipped.push(...boxes.skipped)
  for (const box of boxes.nodes) if (box.levelId) level(box.levelId).prisms.push(...box.prisms)
  const fences = fenceBodies(nodes)
  skipped.push(...fences.skipped)
  for (const fence of fences.fences)
    if (fence.levelId) level(fence.levelId).prisms.push(...fence.prisms)
  const unshaped: Record<string, number> = { ...items.unshaped }
  for (const node of Object.values(nodes))
    if ((NOT_SHAPED_YET as readonly string[]).includes(node.type))
      unshaped[node.type] = (unshaped[node.type] ?? 0) + 1
  if (handrails) unshaped['stair handrail'] = handrails
  const levels = levelIds.map((levelId) => level(levelId))
  const approximate = [
    ...new Set([
      ...levels.flatMap((l) => l.prisms.filter((p) => p.shape === 'approx').map((p) => p.nodeId)),
      ...levels.flatMap((l) => l.floors.filter((f) => f.shape === 'approx').map((f) => f.nodeId)),
    ]),
  ].sort()
  return { levels, approximate, unshaped, skipped }
}
