import { isAgentRefusal, refuse } from '../agent-tools/refusal'
import { planWallOpening } from '../building/wall-openings'
import type { AnyNode, WallNode, ZoneNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { createdSummary } from './created-summary'
import { pointInPolygon } from './plan-geometry'
import { type Space, wallSidesReader } from './reachability'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

type EntryDoorsInput = { levelIds: string[]; width?: number }
type Pt = [number, number]

/** How far past a wall's face the other side is sampled. */
const PROBE = 0.5

const distanceToSegment = ([x, z]: Pt, [ax, az]: Pt, [bx, bz]: Pt) => {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

const onOutline = (point: Pt, polygon: readonly Pt[], tolerance: number) =>
  polygon.some(
    (a, i) => distanceToSegment(point, a, polygon[(i + 1) % polygon.length]!) <= tolerance,
  )

const length = (wall: Pick<WallNode, 'start' | 'end'>) =>
  Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])

type Side = 'party' | 'outside' | 'shared'

/** What lies across this wall from the apartment: another apartment, outside, or a shared space. */
export function across(
  wall: Pick<WallNode, 'start' | 'end' | 'thickness'>,
  zone: readonly Pt[],
  apartments: readonly Pt[][],
  slabs: readonly Pt[][],
): Side {
  const mid: Pt = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
  const len = length(wall) || 1
  let normal: Pt = [-(wall.end[1] - wall.start[1]) / len, (wall.end[0] - wall.start[0]) / len]
  const step = (distance: number): Pt => [
    mid[0] + normal[0] * distance,
    mid[1] + normal[1] * distance,
  ]
  if (pointInPolygon(step(0.05), zone as Pt[], false)) normal = [-normal[0], -normal[1]]
  const probe = step((wall.thickness ?? 0.1) / 2 + PROBE)
  if (apartments.some((other) => other !== zone && pointInPolygon(probe, other as Pt[])))
    return 'party'
  if (!slabs.some((slab) => pointInPolygon(probe, slab as Pt[]))) return 'outside'
  return 'shared'
}

/**
 * `add_entry_doors`: each apartment's entry door, in a wall of its outline whose other side is
 * shared circulation — a corridor zone or open floor, never another apartment, the outside, a lift
 * shaft or a stair well. The largest circulation wins, then the longest wall: Victor run 11 took
 * the longest wall "shared with a corridor or core" and put 30 of 260 doors into a shaft or a well.
 * Apartments are the units on the floors; one that has a door on its outline is left alone, so a
 * repeat is safe; one with no such wall is reported.
 */
export const addEntryDoors: AgentOperation<EntryDoorsInput> = (
  nodes,
  { levelIds, width = 0.9 },
) => {
  const all = Object.values(nodes)
  for (const id of levelIds)
    if (nodes[id]?.type !== 'level')
      refuse('level_not_found', `Level not found: ${id}.`, { levelId: id })

  const sidesOf = wallSidesReader(nodes)
  let working: SceneNodes = nodes
  const changes: Required<Pick<SceneChanges, 'create' | 'update' | 'delete'>> = {
    create: [],
    update: [],
    delete: [],
  }
  const createdIds: string[] = []
  const skipped: { unit: string; level: string; reason: string }[] = []
  let apartmentCount = 0

  for (const levelId of levelIds) {
    const level = nodes[levelId]!
    const zones = new Map(
      all
        .filter((node): node is ZoneNode => node.type === 'zone' && node.parentId === levelId)
        .map((zone) => [zone.id as string, zone]),
    )
    const apartments = all.flatMap((node) =>
      node.type === 'unit' && (node.kind ?? 'apartment') === 'apartment'
        ? node.members.flatMap((member) => {
            const zone = zones.get(member)
            return zone ? [{ unit: node, zone }] : []
          })
        : [],
    )
    const outlines = apartments.map(({ zone }) => zone.polygon as Pt[])
    const slabs = all.flatMap((node) =>
      node.type === 'slab' && node.parentId === levelId ? [node.polygon as Pt[]] : [],
    )
    const walls = all.filter(
      (node): node is WallNode =>
        node.type === 'wall' && node.parentId === levelId && !node.curveOffset,
    )
    apartmentCount += apartments.length

    for (const [index, { unit, zone }] of apartments.entries()) {
      const outline = outlines[index]!
      const bounding = walls.filter((wall) => {
        const tolerance = (wall.thickness ?? 0.1) / 2 + 0.05
        const mid: Pt = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
        return [wall.start as Pt, wall.end as Pt, mid].every((point) =>
          onOutline(point, outline, tolerance),
        )
      })
      const name = unit.name ?? zone.name ?? unit.id
      const report = (reason: string) =>
        skipped.push({ unit: name, level: level.name ?? levelId, reason })
      const hasDoor = bounding.some((wall) =>
        (working[wall.id] as WallNode | undefined)?.children.some(
          (id) => working[id]?.type === 'door',
        ),
      )
      if (hasDoor) {
        report('has_door')
        continue
      }
      // The circulation a door at `along` would open onto: its area, open floor counting as
      // unbounded; null when it would open onto anything else.
      const circulation = (wall: WallNode, along: number) => {
        const other = sidesOf(wall, along)?.find(
          (side: Space) =>
            !(
              side.kind === 'zone' &&
              (side.key === `zone:${zone.id}` || side.apartment === unit.id)
            ),
        )
        if (other?.kind === 'floor') return Number.POSITIVE_INFINITY
        if (other?.kind === 'zone' && !other.apartment) return other.area
        return null
      }
      const shared = bounding
        .filter(
          (wall) =>
            length(wall) >= width + 0.3 && across(wall, outline, outlines, slabs) === 'shared',
        )
        .map((wall) => ({ wall, area: circulation(wall, length(wall) / 2) }))
        .filter(
          (candidate): candidate is { wall: WallNode; area: number } => candidate.area !== null,
        )
        .sort((a, b) => b.area - a.area || length(b.wall) - length(a.wall))
        .map(({ wall }) => wall)
      if (!shared.length) {
        report('no_corridor_wall')
        continue
      }
      let placed: ReturnType<typeof planWallOpening> | null = null
      for (const wall of shared) {
        for (const t of [0.5, 0.25, 0.75]) {
          if (circulation(wall, t * length(wall)) === null) continue
          try {
            placed = planWallOpening(working as Record<string, AnyNode>, {
              kind: 'door',
              wallId: wall.id,
              t,
              width,
            })
            break
          } catch (error) {
            if (!isAgentRefusal(error)) throw error
          }
        }
        if (placed) break
      }
      if (!placed) {
        report('no_room_on_wall')
        continue
      }
      const door = { ...placed.node, name: `${name} entry` } as AnyNode
      const set = { create: [{ node: door, parentId: placed.wallId }] }
      changes.create.push(...set.create)
      working = applySceneChanges(working, set)
      createdIds.push(door.id)
    }
  }

  const counts = {
    doors: createdIds.length,
    apartments: apartmentCount,
    ...(skipped.length ? { skipped: skipped.slice(0, 40), skippedCount: skipped.length } : {}),
  }
  if (!createdIds.length) return { result: { status: 'already_present', ...counts } }
  return { result: { status: 'created', ...createdSummary(createdIds), ...counts }, changes }
}
