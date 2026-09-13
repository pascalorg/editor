/**
 * MEP in a concrete-block wall. A block wall has no stud bays: the NM cable,
 * the PEX drops and the small copper live in the FURRING SPACE on its
 * inside face (1x furring + 1/2 in gypsum — the Florida block house), the
 * boxes are shallow ones cut into the furring, and anything that must
 * CROSS the block (the service entrance, the water service) goes through a
 * sleeve. A drain or vent stack does not fit a furring space at all — it
 * wants a furred chase or an interior wall, and is flagged. Steve,
 * 2026-09-09: "electrical cant go into cmu block walls either".
 *
 * This pass runs after the wiring, plumbing and HVAC engines: any of their
 * members whose plan line lies inside a block wall's core is moved to the
 * furring plane on the wall's interior side, labelled so; a member that
 * runs THROUGH the wall (its axis across the wall) keeps its place and is
 * labelled a sleeve; a member too big for the furring is flagged.
 */
import type { Member, RoomSlice, SlabSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { pointInPolygon } from './electrical'
import { exteriorSide } from './wall-layers'

/** 1x furring (3/4 in) + 1/2 in gypsum — the block wall's interior finish. */
export const BLOCK_FURRING = inches(0.75)
const BLOCK_GYPSUM = inches(0.5)
/** The largest member (across the furring) that fits the furring space. */
const FURRING_FIT = BLOCK_FURRING + 0.004
/** A crossing this short is a device pigtail, not a run through the wall. */
const STUB_MAX = 0.25

export const BLOCK_CHASE_FLAG =
  'BLOCK: no stud bay in a concrete-block wall and this does not fit the furring space — a furred chase or an interior wall; verify'

export type BlockWall = {
  wall: WallSlice
  /** Level-local y the block stops at (a mixed knee wall); undefined = full height. */
  cmuTopY?: number
}

export interface BlockFurringResult {
  members: Member[]
  /** Members moved into the furring space. */
  furred: number
  /** Members crossing the block, labelled as sleeved. */
  sleeved: number
  /** Members that do not fit the furring — flagged. */
  flagged: number
  warnings: string[]
}

type Pt = readonly [number, number]

/** Signed distance of a plan point across a wall (+ on the wall's left normal side), and its station. */
function across(wall: WallSlice, p: Pt): { d: number; t: number } {
  const dx = wall.dir[0]
  const dz = wall.dir[1]
  const rx = p[0] - wall.start[0]
  const rz = p[1] - wall.start[1]
  return { t: rx * dx + rz * dz, d: -dz * rx + dx * rz }
}

/**
 * Move the wiring, the pipes and the small ducts out of the block walls'
 * cores into the furring space on the interior face. `rooms` and `slabs`
 * tell which face is inside (the wall-layers' exteriorSide rule).
 */
export function furOutOfBlock(
  members: readonly Member[],
  blocks: readonly BlockWall[],
  rooms: RoomSlice[],
  slabs: SlabSlice[] = [],
): BlockFurringResult {
  const out: Member[] = []
  let furred = 0
  let sleeved = 0
  let flagged = 0
  if (blocks.length === 0) return { members: [...members], furred, sleeved, flagged, warnings: [] }
  const interiorSign = new Map<string, 1 | -1>()
  const indoor = rooms.filter((r) => r.category !== 'outdoor')
  for (const b of blocks) {
    const w = b.wall
    const mid: Pt = [w.start[0] + (w.dir[0] * w.length) / 2, w.start[1] + (w.dir[1] * w.length) / 2]
    const reach = w.thickness / 2 + 0.15
    const probe = (sign: 1 | -1): Pt => [mid[0] - w.dir[1] * sign * reach, mid[1] + w.dir[0] * sign * reach]
    const inRoom = (p: Pt) => indoor.some((r) => pointInPolygon(p, r.polygon))
    const plus = inRoom(probe(1))
    const minus = inRoom(probe(-1))
    if (plus !== minus) {
      interiorSign.set(w.id, plus ? 1 : -1)
      continue
    }
    // both or neither: the wall-layers' rule (flooring, then rooms); side 1
    // there is the same left normal as +d here
    const ext = exteriorSide(w, rooms, slabs)
    interiorSign.set(w.id, ext === 1 ? -1 : 1)
  }

  for (const m of members) {
    if (m.system !== 'electrical' && m.system !== 'plumbing' && m.system !== 'hvac') {
      out.push(m)
      continue
    }
    // equipment and fixtures stand on the face already; only the runs move
    if (m.role !== 'wire-run' && m.role !== 'pipe-run' && m.role !== 'duct-run') {
      out.push(m)
      continue
    }
    const p: Pt = [m.position[0], m.position[2]]
    // the member's plan axis: along the wall, across it, or vertical
    const [rx, ry, rz] = m.rotation
    const vertical = rx === 0 && ry === 0 && rz === 0 && m.dims[1] >= m.dims[0] && Math.abs(m.dims[1] - m.length) < 1e-6
    const yaw = ry
    const axisX = Math.cos(yaw)
    const axisZ = -Math.sin(yaw)
    const alongWall = (w: WallSlice) => (vertical ? 1 : Math.abs(axisX * w.dir[0] + axisZ * w.dir[1]))
    // the block wall the member lies in — at a corner two walls claim the
    // point; the one the run is parallel to owns it (a run along the front
    // wall is not a sleeve through the side wall)
    let hit: BlockWall | null = null
    let hitAlong = -1
    for (const b of blocks) {
      const { d, t } = across(b.wall, p)
      if (t < -0.02 || t > b.wall.length + 0.02) continue
      if (Math.abs(d) >= b.wall.thickness / 2 - BLOCK_GYPSUM - 1e-6) continue
      if (b.cmuTopY !== undefined && m.position[1] - m.dims[1] / 2 > b.cmuTopY) continue
      const along = alongWall(b.wall)
      if (along > hitAlong) {
        hit = b
        hitAlong = along
      }
    }
    if (!hit) {
      out.push(m)
      continue
    }
    const wall = hit.wall
    const alongness = hitAlong
    if (!vertical && alongness < 0.7) {
      if (m.length <= STUB_MAX && m.role === 'wire-run') {
        // the pigtail from the wall plane out to a device box: in a block
        // wall the box sits in the furring, so the pigtail is the furring's
        // depth on the interior face
        const sign = interiorSign.get(wall.id) ?? 1
        const target = sign * (wall.thickness / 2 - BLOCK_GYPSUM - BLOCK_FURRING / 2)
        const { d } = across(wall, p)
        const shift = target - d
        const nx = -wall.dir[1]
        const nz = wall.dir[0]
        out.push({
          ...m,
          dims: [BLOCK_FURRING, m.dims[1], m.dims[2]],
          length: BLOCK_FURRING,
          position: [m.position[0] + nx * shift, m.position[1], m.position[2] + nz * shift],
          label: `${m.label ?? ''} (furring space on the block)`.trim(),
        })
        furred++
        continue
      }
      // crossing the block: a sleeve through the wall
      out.push({ ...m, label: `${m.label ?? ''} (sleeved through the block)`.trim() })
      sleeved++
      continue
    }
    // the member's extent across the furring: its smallest plan dimension
    const acrossSize = vertical ? Math.min(m.dims[0], m.dims[2]) : m.dims[2]
    if (acrossSize > FURRING_FIT) {
      out.push({ ...m, flag: m.flag ?? BLOCK_CHASE_FLAG })
      flagged++
      continue
    }
    const sign = interiorSign.get(wall.id) ?? 1
    // the furring plane: between the block's inside face and the gypsum
    const target = sign * (wall.thickness / 2 - BLOCK_GYPSUM - BLOCK_FURRING / 2)
    const { d } = across(wall, p)
    const shift = target - d
    if (Math.abs(shift) < 0.003) {
      // already in the furring space
      out.push(m)
      continue
    }
    const nx = -wall.dir[1]
    const nz = wall.dir[0]
    out.push({
      ...m,
      position: [m.position[0] + nx * shift, m.position[1], m.position[2] + nz * shift],
      label: `${m.label ?? ''} (furring space on the block)`.trim(),
    })
    furred++
  }

  const warnings: string[] = []
  if (furred > 0)
    warnings.push(
      `${furred} wiring / piping runs sit in the 3/4 in furring space on the inside of the block walls (no stud bays in CMU — shallow boxes; verify the furring depth with the trades)`,
    )
  if (sleeved > 0) warnings.push(`${sleeved} runs cross a block wall through a sleeve`)
  if (flagged > 0)
    warnings.push(
      `${flagged} runs do not fit a block wall's furring space (drain / vent / large pipe) — a furred chase or an interior wall; flagged — verify`,
    )
  return { members: out, furred, sleeved, flagged, warnings }
}
