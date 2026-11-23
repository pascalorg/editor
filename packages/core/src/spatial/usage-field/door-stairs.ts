import { CODE_PROFILES, type CodeProfile, codeProfileOf } from '../../building/code-profile'
import { area, difference, intersection, type Polygon, type Ring } from '../../lib/polygon-boolean'
import type { StairNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import {
  resolveStairWalkingSurfaces,
  type StairWalkingSurface,
} from '../../systems/stair/stair-clearance'
import type { UsageIssue } from './findings'
import { m, nameOf, quote, unique } from './labels'
import { roomAt } from './pieces'
import {
  doorFrame,
  FRAME_M,
  hingeOf,
  hungOf,
  leafDirection,
  SWEEP_STEP_DEG,
  swingDoors,
} from './swings'
import type { UsageShapes } from './types'
import type { Nodes } from './walls'

/** A tread this far under the threshold or less is steps the leaf is read against; further down it is another storey's. */
const BAND_M = 0.6
/** Less of the sweep than this over a tread is the leaf grazing its edge (m2). */
const MIN_OVERLAP_M2 = 0.01
/** How far from the wall's centre line the room behind or ahead of a door is looked for (m). */
const ROOM_PROBE_M = 0.4
/** A floor within this far above the door's own still carries it (a slab's finish). */
const FLOOR_ABOVE_M = 0.25

/** The ground a leaf covers while it opens: a fan from the hinge, closed to 90 degrees, as long as the leaf. */
function sweptFan(
  hinge: [number, number],
  length: number,
  direction: (theta: number) => [number, number],
): Ring {
  const ring: Ring = [hinge]
  for (let a = 0; a <= 90; a += SWEEP_STEP_DEG) {
    const [dx, dz] = direction((a * Math.PI) / 180)
    ring.push([hinge[0] + dx * length, hinge[1] + dz * length])
  }
  return ring
}

/**
 * A door whose leaf swings over steps. Both texts the checks read say it: a floor or landing is not
 * required at the top of an interior flight "provided that a door does not swing over the stairs"
 * (R311.7.6), and a landing at an exterior door may be 7-3/4 in below the threshold, or a flight of two
 * risers need no top landing, only where the door does not swing over it (R311.3.1, R311.3.2). So the
 * leaf's sweep is read against the treads and landings of every stair that lie more than 1-1/2 in below
 * the door's own floor; ground the door's level covers (a slab, a landing at the threshold) is not steps.
 * The text says nothing of a door swinging over a flat landing: that is a design preference (Architect
 * Pro's `door_over_landing` keeps both landings clear), not this check.
 *
 * It is a code's rule. With no `site.metadata.codeProfile` a finding is information that names the US
 * IRC it used; with `irc-2021` it is a warning; a profile with no row for it reports nothing.
 */
export function doorOverStairIssues(nodes: Nodes, shapes: UsageShapes): UsageIssue[] {
  const profile = codeProfileOf(nodes)
  const applied: CodeProfile = profile ?? CODE_PROFILES['irc-2021']
  const row = applied.thresholds.doorThresholdDrop
  if (!row) return []

  const stairs: { stair: StairNode; surfaces: StairWalkingSurface[] }[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'stair') continue
    try {
      stairs.push({ stair: node, surfaces: resolveStairWalkingSurfaces(node, nodes as never) })
    } catch {
      // a stair whose surfaces cannot be read (its detail is over budget) has nothing to sweep against
    }
  }
  if (stairs.length === 0) return []

  const elevations = getLevelElevations(nodes as never)
  const out: UsageIssue[] = []
  for (const level of shapes.levels) {
    const baseY = elevations.get(level.levelId)?.baseY ?? 0
    const steps = stairs
      .map(({ stair, surfaces }) => ({
        stair,
        surfaces: surfaces.filter(
          (surface) => surface.top <= baseY - row.value && surface.top >= baseY - BAND_M,
        ),
      }))
      .filter(({ surfaces }) => surfaces.length > 0)
    if (steps.length === 0) continue
    const floors: Polygon[] = shapes.levels
      .flatMap((other) => other.floors)
      .filter((floor) => floor.y >= baseY - row.value && floor.y <= baseY + FLOOR_ABOVE_M)
      .map((floor) => ({ outer: floor.outer, holes: floor.holes }))

    for (const door of swingDoors(nodes, level.levelId)) {
      const hung = hungOf(door)
      const frame = doorFrame(nodes, door)
      const hinge = hingeOf(nodes, door, hung)
      const fan = sweptFan(hinge, 2 * frame.half - FRAME_M, (theta) =>
        leafDirection(frame, hung, theta),
      )
      // the room the door belongs to is the one behind the leaf; failing that, the one it swings into
      const centre: [number, number] = [
        frame.sx + frame.tx * frame.along,
        frame.sz + frame.tz * frame.along,
      ]
      const beside = (side: number): [number, number] => [
        centre[0] + frame.nx * hung.swing * side * ROOM_PROBE_M,
        centre[1] + frame.nz * hung.swing * side * ROOM_PROBE_M,
      ]
      const room =
        roomAt(nodes, level.levelId, beside(-1)) ?? roomAt(nodes, level.levelId, beside(1))
      for (const { stair, surfaces } of steps) {
        let over = 0
        let nearest = Number.NEGATIVE_INFINITY
        for (const surface of surfaces) {
          const swept = intersection(fan, surface.region)
          if (swept.length === 0) continue
          const bare = area(floors.length ? difference(swept, floors) : swept)
          if (bare < MIN_OVERLAP_M2) continue
          over += bare
          nearest = Math.max(nearest, surface.top)
        }
        if (over === 0) continue
        const drop = baseY - nearest
        const name = nameOf(nodes, door.id)
        const stairName = nameOf(nodes, stair.id)
        out.push({
          type: 'usage_door_over_stair',
          message: `${quote(name)}${room ? ` in ${quote(room.name)}` : ''} swings over the steps of ${quote(stairName)}: its leaf passes over ${m(over)} m² of treads, the nearest ${m(drop)} m below the threshold, where ${applied.label} (${row.section}) wants a floor or landing for the leaf to open onto${profile ? '' : ', and this project names no code'}. Swing it the other way, hinge it on the other side, or give the stair a landing as deep as the door is wide.`,
          severity: profile ? 'warning' : 'info',
          nodeIds: unique([room?.id, door.id, stair.id]),
          valueM: Math.round(drop * 1000) / 1000,
          thresholdM: row.value,
          place: { room: room?.name ?? '', roomId: room?.id ?? level.levelId, at: hinge },
          obstacles: [
            { nodeId: stair.id, name: stairName, kind: 'stair', shape: 'exact', movable: false },
          ],
          approximate: false,
          code: {
            profile: applied.id,
            cite: row.cite,
            source: row.source,
            byDefault: profile === null,
          },
        })
      }
    }
  }
  return out
}
