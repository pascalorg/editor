import {
  type AnyNode,
  type AnyNodeId,
  DuctSegmentNode,
  type PortConnection,
} from '@pascal-app/core'
import { fittingLegLength } from '../duct-fitting/ports'
import type { DuctFittingNode } from '../duct-fitting/schema'
import {
  type DuctProfile,
  planElbowAtPort,
  planElbowRealign,
  profileDiameterIn,
} from './auto-fitting'
import type { ScenePort } from './ports'

/**
 * Center-cube vertical-move auto-routing for duct runs.
 *
 * When a run is lifted / lowered with the run-center cube's ±Y arrows, a
 * RUN-connected end should stay welded to its (stationary) partner by way of
 * an offset: an elbow on the lifted run, a plumb riser down to the partner's
 * height, and a second elbow that meets the partner — the classic duct S/Z
 * offset. Without it, plain connectivity-follow would translate the collinear
 * partner run straight up too (it has no turn to absorb the lift), dragging
 * the whole network along.
 *
 * RUN-connected end (partner stays at its old height):
 *   - top elbow at the lifted endpoint, turning the run axis → vertical;
 *   - a plumb riser straight down (same X/Z) to one leg above the partner;
 *   - bottom elbow at the partner joint, turning vertical → the partner's
 *     axis; the partner run is trimmed back one leg so the elbow replaces
 *     that stretch.
 * The lifted run is trimmed back one leg at the offset end so it meets the
 * top elbow's collar instead of overlapping it.
 *
 * ELBOW-connected end (a clean L): the existing elbow STAYS PUT and re-aims so
 * its mated collar swings vertical (flattening toward a straight coupling); a
 * plumb riser rises from that collar to a single new TOP elbow that turns back
 * along the run axis onto the lifted endpoint. One new elbow + one riser — no
 * horizontal jog. Non-elbow fittings (and elbows whose re-aim is out of the
 * buildable 15–90° range) ride up via plain connectivity-follow instead. Open
 * ends likewise just ride up.
 */

type Point = [number, number, number]

/** Joint-coincidence epsilon (m), matching core's port connectivity. */
const COINCIDENT_EPS_M = 0.05
/** Shortest riser worth minting — below this there's no room to offset, so
 *  the caller keeps the plain vertical translate. */
const MIN_RISER_M = 0.05

export type VerticalOffsetPlan = {
  /** The lifted run's new path: every point raised by `dy`, each RUN-offset
   *  end trimmed back one elbow-leg to meet its top elbow (fitting / open ends
   *  keep their lifted endpoint). */
  ductPath: Point[]
  /** The path to seed the caller's connectivity-follow from: identical to the
   *  lifted run except each RUN-offset end is reset to its ORIGINAL height, so
   *  its trimmed partner shows zero delta (we trim it via `updates` instead)
   *  while a FITTING / open end shows `+dy` — lifting its elbow rigidly and
   *  lengthening that elbow's riser into a clean L. */
  followPath: Point[]
  /** Two elbows per RUN-offset end (top + bottom). */
  fittings: DuctFittingNode[]
  /** One plumb riser per RUN-offset end. */
  risers: DuctSegmentNode[]
  /** Partner-run trims (the run mated at each RUN-offset end pulled back one
   *  leg). Fitting partners are rigid and never updated. */
  updates: { id: AnyNodeId; data: Partial<AnyNode> }[]
}

function distSq(a: Point | readonly number[], b: Point | readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

/** Outward unit direction at the run endpoint `idx` (0 = start, last = end). */
function endpointOutwardDir(path: ReadonlyArray<readonly number[]>, idx: number): Point {
  const last = path.length - 1
  const [a, b] = idx === 0 ? [path[0]!, path[1]!] : [path[last]!, path[last - 1]!]
  const d: Point = [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
  const len = Math.hypot(d[0], d[1], d[2])
  return len < 1e-9 ? [1, 0, 0] : [d[0] / len, d[1] / len, d[2] / len]
}

/** Minimal ScenePort the elbow planner needs (position + direction + system). */
function portLike(position: Point, direction: Point, system: string): ScenePort {
  return {
    id: 'x',
    nodeId: 'x' as AnyNodeId,
    position,
    direction,
    diameter: 0,
    system,
  } as unknown as ScenePort
}

/** A plumb riser duct-segment between two points, carrying the run's profile. */
function makeRiser(from: Point, to: Point, duct: DuctSegmentNode): DuctSegmentNode {
  return DuctSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: duct.name ?? 'Duct run',
    path: [from, to],
    shape: duct.shape,
    diameter: duct.diameter,
    width: duct.width,
    height: duct.height,
    roll: duct.roll,
    ductMaterial: duct.ductMaterial,
    insulated: duct.insulated,
    insulationR: duct.insulationR,
    system: duct.system,
  })
}

export function planVerticalOffsets(args: {
  duct: DuctSegmentNode
  /** Signed vertical move (meters); +up / -down. */
  dy: number
  profile: DuctProfile
  /** The drag-start connectivity snapshot's connections. */
  connections: PortConnection[]
  /** Scene ports (excluding the lifted run) for partner direction lookup. */
  scenePorts: ScenePort[]
  /** Drag-start node snapshots keyed by id, so a connected elbow's ORIGINAL
   *  pose can be re-aimed each frame (the live store carries the last frame's
   *  re-aim). */
  nodesById: Record<string, AnyNode>
}): VerticalOffsetPlan | null {
  const { duct, dy, profile, connections, scenePorts, nodesById } = args
  if (connections.length === 0) return null
  const leg = fittingLegLength(profileDiameterIn(profile))
  // Need room for both elbow legs plus a real riser between them.
  if (Math.abs(dy) - 2 * leg < MIN_RISER_M) return null

  const startPath = duct.path.map((p) => [...p] as Point)
  const last = startPath.length - 1
  const vSign = Math.sign(dy)
  const up: Point = [0, vSign, 0]
  const down: Point = [0, -vSign, 0]
  const eps2 = COINCIDENT_EPS_M * COINCIDENT_EPS_M

  // Lift the whole run; connected ends get adjusted below.
  const ductPath = startPath.map((p) => [p[0], p[1] + dy, p[2]] as Point)
  // Seed for the caller's connectivity-follow: starts as the lifted path, but
  // each RUN-offset end is reset to its original point below so that end shows
  // zero delta (its partner is trimmed via `updates`, not dragged), while any
  // FITTING / open end stays lifted so its partner follows.
  const followPath = startPath.map((p) => [p[0], p[1] + dy, p[2]] as Point)

  const fittings: DuctFittingNode[] = []
  const risers: DuctSegmentNode[] = []
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  let offsetAny = false

  for (const endIdx of last > 0 ? [0, last] : [0]) {
    const endPos = startPath[endIdx]!
    // Partner port sitting on this end, owned by a snapshotted connection.
    const partnerPort = scenePorts.find(
      (sp) =>
        distSq(sp.position, endPos) <= eps2 && connections.some((c) => c.nodeId === sp.nodeId),
    )
    if (!partnerPort) continue // open end → just rides up
    const conn = connections.find((c) => c.nodeId === partnerPort.nodeId)!

    const ductPortDir = endpointOutwardDir(startPath, endIdx)
    const liftedEnd: Point = [endPos[0], endPos[1] + dy, endPos[2]]

    // FITTING partner: a clean L. The existing ELBOW stays put and re-aims so
    // its mated collar swings vertical (flattening toward a straight coupling);
    // a plumb riser rises from that collar to a single new TOP elbow that turns
    // back along the run axis onto the lifted endpoint. Non-elbow fittings (or
    // an elbow whose re-aim falls out of buildable range) ride up via plain
    // connectivity-follow instead — no offset minted.
    if (conn.kind !== 'run') {
      const partner = nodesById[conn.nodeId]
      if (!partner || partner.type !== 'duct-fitting') continue
      const elbow = partner as DuctFittingNode
      if (elbow.fittingType !== 'elbow') continue
      // Re-aim the existing elbow's mated collar to vertical; its other collar
      // (mated to the rest of the run) stays fixed.
      const realign = planElbowRealign(elbow, partnerPort.id, up)
      if (!realign) continue
      // Top elbow: junction plumb above the elbow at the lifted height. Its
      // "existing run" is the riser, whose top port faces UP; the new run
      // leaves back along the run axis (awayBack) onto the lifted endpoint.
      const topJunction: Point = [elbow.position[0], liftedEnd[1], elbow.position[2]]
      const awayBack: Point = [-ductPortDir[0], -ductPortDir[1], -ductPortDir[2]]
      const top = planElbowAtPort(portLike(topJunction, up, duct.system), awayBack, profile)
      if (!top) continue

      fittings.push(top.fitting)
      // Plumb riser: the re-aimed elbow's vertical collar up to the top elbow's
      // riser collar (its trimmedPortPoint) — both at the elbow's XZ.
      risers.push(makeRiser(realign.collarPoint, top.trimmedPortPoint, duct))
      // Re-aim patch for the existing elbow.
      updates.push({ id: elbow.id, data: realign.update.data as Partial<AnyNode> })
      // Lifted run ends on the top elbow's outlet collar (= the lifted
      // endpoint); zero this end's connectivity-follow delta — the re-aim
      // already reconnects it.
      ductPath[endIdx] = top.collarPoint
      followPath[endIdx] = [...startPath[endIdx]!] as Point
      offsetAny = true
      continue
    }

    const partnerDir: Point = [
      partnerPort.direction[0],
      partnerPort.direction[1],
      partnerPort.direction[2],
    ]

    // Bottom elbow at the partner joint: turn from the partner's axis up the
    // riser. Partner run trims to its inlet collar.
    const bottom = planElbowAtPort(portLike(endPos, partnerDir, duct.system), up, profile)
    // Top elbow at the lifted endpoint: turn from the run axis down the
    // riser. Lifted run trims to its inlet collar.
    const top = planElbowAtPort(portLike(liftedEnd, ductPortDir, duct.system), down, profile)
    if (!bottom || !top) return null

    fittings.push(bottom.fitting, top.fitting)
    risers.push(makeRiser(bottom.collarPoint, top.collarPoint, duct))
    ductPath[endIdx] = top.trimmedPortPoint
    // This end's partner is trimmed (below), not dragged — keep its follow-seed
    // at the original height so connectivity-follow sees zero delta here.
    followPath[endIdx] = [...startPath[endIdx]!] as Point

    // Trim the partner run's mated end back one leg.
    const path = conn.startPath.map((p) => [...p] as Point)
    const tip = path.findIndex((p) => distSq(p, endPos) <= eps2)
    if (tip !== -1) {
      path[tip] = bottom.trimmedPortPoint
      updates.push({ id: conn.nodeId, data: { path } as Partial<AnyNode> })
    }
    offsetAny = true
  }

  if (!offsetAny) return null
  return { ductPath, followPath, fittings, risers, updates }
}
