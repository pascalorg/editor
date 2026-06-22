import {
  type AnyNode,
  type AnyNodeId,
  DuctSegmentNode,
  type PortConnection,
} from '@pascal-app/core'
import { Vector3 } from 'three'
import { fittingLegLength, getDuctFittingPorts } from '../duct-fitting/ports'
import type { DuctFittingNode } from '../duct-fitting/schema'
import { rollToContinueAcrossElbow } from '../duct-segment/geometry'
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

/**
 * Three-state outcome of a connected vertical lift:
 *  - `null` — the run has NO connected ends, so the caller plain-translates it
 *    (nothing to keep welded; everyone is free to ride along or there's no one).
 *  - `{ status: 'invalid' }` — at least one connected end CANNOT form a clean
 *    offset at this height (no room for the elbows + riser, a non-elbow fitting,
 *    or a re-aim out of the buildable 15–90° range). The caller lifts ONLY the
 *    dragged run as a red preview, freezes every partner, and commits nothing on
 *    release. We never silently drag the network up to "absorb" the lift.
 *  - `{ status: 'valid', plan }` — every connected end welds back to its
 *    stationary partner via the planned offset; the caller lifts + trims, ghosts
 *    the new fittings green, and mints them on release.
 */
export type VerticalOffsetResult =
  | { status: 'valid'; plan: VerticalOffsetPlan }
  | { status: 'invalid' }
  | null

export type VerticalOffsetPlan = {
  /** Actual vertical offset used by the route. This can differ from the raw
   *  cursor delta when the route snaps through a topology transition. */
  dy: number
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
  /** Existing generated/absorbed parts to remove when an offset collapses into a direct L. */
  delete?: AnyNodeId[]
}

function distSq(a: Point | readonly number[], b: Point | readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

function distToAxisSq(point: Point, origin: Point, axis: Point): number {
  const dx = point[0] - origin[0]
  const dy = point[1] - origin[1]
  const dz = point[2] - origin[2]
  const along = dx * axis[0] + dy * axis[1] + dz * axis[2]
  const px = dx - axis[0] * along
  const py = dy - axis[1] * along
  const pz = dz - axis[2] * along
  return px * px + py * py + pz * pz
}

/** Outward unit direction at the run endpoint `idx` (0 = start, last = end). */
function endpointOutwardDir(path: ReadonlyArray<readonly number[]>, idx: number): Point {
  const last = path.length - 1
  const [a, b] = idx === 0 ? [path[0]!, path[1]!] : [path[last]!, path[last - 1]!]
  const d: Point = [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
  const len = Math.hypot(d[0], d[1], d[2])
  return len < 1e-9 ? [1, 0, 0] : [d[0] / len, d[1] / len, d[2] / len]
}

/** Classifies whether the partner run's segment ADJACENT to its tip at
 *  `endPos` is a plumb existing riser that can safely stretch to `liftedEnd`.
 *  The lifted joint must stay on the same side of the fixed adjacent vertex;
 *  otherwise connectivity-follow would collapse the riser to zero or invert it
 *  through the upper/lower L, which makes connected ductwork disappear. */
function alignedVerticalRiserStretch(
  path: ReadonlyArray<readonly number[]> | undefined,
  endPos: Point,
  liftedEnd: Point,
  eps2: number,
): 'stretch' | 'invalid' | null {
  if (!path || path.length < 2) return null
  const tip = path.findIndex((p) => distSq(p, endPos) <= eps2)
  if (tip !== 0 && tip !== path.length - 1) return null // not an endpoint joint
  const adj = tip === 0 ? path[1]! : path[path.length - 2]!
  const dxz = Math.hypot(adj[0]! - endPos[0], adj[2]! - endPos[2])
  if (dxz > COINCIDENT_EPS_M) return null
  const originalSpan = adj[1]! - endPos[1]
  if (Math.abs(originalSpan) <= MIN_RISER_M) return null
  const nextSpan = adj[1]! - liftedEnd[1]
  if (Math.sign(nextSpan) !== Math.sign(originalSpan) || Math.abs(nextSpan) <= MIN_RISER_M) {
    return 'invalid'
  }
  return 'stretch'
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
function makeRiser(
  from: Point,
  to: Point,
  duct: DuctSegmentNode,
  roll = duct.roll,
): DuctSegmentNode {
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
    roll,
    ductMaterial: duct.ductMaterial,
    insulated: duct.insulated,
    insulationR: duct.insulationR,
    system: duct.system,
  })
}

function rollForRiser(sourceDir: Point, sourceRoll: number, riserDir: Point): number {
  return rollToContinueAcrossElbow(
    new Vector3(...sourceDir),
    sourceRoll,
    new Vector3(...sourceDir),
    new Vector3(...riserDir),
  )
}

function elbowProfilePatch(profile: DuctProfile): Partial<DuctFittingNode> {
  const diameter = profileDiameterIn(profile)
  return {
    shape: profile.shape,
    width: profile.width,
    height: profile.height,
    diameter,
    diameter2: diameter,
  }
}

type FittingRiserAction =
  | { status: 'stretch' }
  | {
      status: 'collapse'
      delete: AnyNodeId[]
      updates: { id: AnyNodeId; data: Partial<AnyNode> }[]
      ductPoint: Point
    }
  | { status: 'snap'; dy: number }
  | null

type RiserCollapseAction =
  | {
      status: 'collapse'
      delete: AnyNodeId[]
      updates: { id: AnyNodeId; data: Partial<AnyNode> }[]
      ductPoint: Point
    }
  | { status: 'snap'; dy: number }
  | null

function directRiserCollapseAction(args: {
  riserId: AnyNodeId
  riserPath: ReadonlyArray<readonly number[]>
  riserTopPoint: Point
  liftedDuctPoint: Point
  ductEndPoint: Point
  ductPortDir: Point
  profilePatch: Partial<DuctFittingNode>
  connections: PortConnection[]
  scenePorts: ScenePort[]
  nodesById: Record<string, AnyNode>
  eps2: number
}): RiserCollapseAction {
  const {
    riserId,
    riserPath,
    riserTopPoint,
    liftedDuctPoint,
    ductEndPoint,
    ductPortDir,
    profilePatch,
    connections,
    scenePorts,
    nodesById,
    eps2,
  } = args
  const tip = riserPath.findIndex((p) => distSq(p, riserTopPoint) <= eps2)
  if (tip !== 0 && tip !== riserPath.length - 1) return null
  const farPoint = tip === 0 ? riserPath[1]! : riserPath[riserPath.length - 2]!
  const farPort = scenePorts.find(
    (sp) =>
      sp.nodeId !== riserId &&
      distSq(sp.position, farPoint) <= eps2 &&
      connections.some((c) => c.nodeId === sp.nodeId && c.kind !== 'run'),
  )
  if (!farPort) return null
  const lower = nodesById[farPort.nodeId]
  if (!lower || lower.type !== 'duct-fitting') return null
  const lowerElbow = { ...(lower as DuctFittingNode), ...profilePatch } as DuctFittingNode
  if (lowerElbow.fittingType !== 'elbow') return null

  const directDir: Point = [-ductPortDir[0], -ductPortDir[1], -ductPortDir[2]]
  const realign = planElbowRealign(lowerElbow, farPort.id, directDir)
  if (!realign) return null
  const collarOnLiftedLevel: Point = [
    realign.collarPoint[0],
    liftedDuctPoint[1],
    realign.collarPoint[2],
  ]
  if (distToAxisSq(collarOnLiftedLevel, liftedDuctPoint, ductPortDir) > eps2) return null
  if (Math.abs(realign.collarPoint[1] - liftedDuctPoint[1]) > COINCIDENT_EPS_M) {
    return { status: 'snap', dy: realign.collarPoint[1] - ductEndPoint[1] }
  }
  return {
    status: 'collapse',
    delete: [riserId],
    updates: [
      {
        id: lowerElbow.id,
        data: { ...profilePatch, ...realign.update.data } as Partial<AnyNode>,
      },
    ],
    ductPoint: realign.collarPoint,
  }
}

function fittingRiserAction(args: {
  fitting: DuctFittingNode
  matedPortId: string
  ductPortDir: Point
  ductEndPoint: Point
  liftedDuctPoint: Point
  profilePatch: Partial<DuctFittingNode>
  dy: number
  connections: PortConnection[]
  scenePorts: ScenePort[]
  nodesById: Record<string, AnyNode>
  eps2: number
}): FittingRiserAction {
  const {
    fitting,
    matedPortId,
    ductPortDir,
    ductEndPoint,
    liftedDuctPoint,
    profilePatch,
    dy,
    connections,
    scenePorts,
    nodesById,
    eps2,
  } = args
  const ports = getDuctFittingPorts(fitting)
  for (const port of ports) {
    if (port.id === matedPortId) continue
    const otherPort = scenePorts.find(
      (sp) =>
        sp.nodeId !== fitting.id &&
        distSq(sp.position, port.position) <= eps2 &&
        connections.some((c) => c.nodeId === sp.nodeId && c.kind === 'run'),
    )
    if (!otherPort) continue
    const partner = nodesById[otherPort.nodeId]
    const partnerPath = (partner as unknown as { path?: Point[] } | undefined)?.path
    const portPosition: Point = [port.position[0], port.position[1], port.position[2]]
    const liftedPort: Point = [port.position[0], port.position[1] + dy, port.position[2]]
    const stretch = alignedVerticalRiserStretch(partnerPath, portPosition, liftedPort, eps2)
    if ((stretch === 'stretch' || stretch === 'invalid') && partnerPath) {
      const tip = partnerPath.findIndex((p) => distSq(p, portPosition) <= eps2)
      if (tip !== 0 && tip !== partnerPath.length - 1) {
        if (stretch === 'stretch') return { status: 'stretch' }
        continue
      }
      const farPoint = tip === 0 ? partnerPath[1]! : partnerPath[partnerPath.length - 2]!
      const farPort = scenePorts.find(
        (sp) =>
          sp.nodeId !== fitting.id &&
          sp.nodeId !== otherPort.nodeId &&
          distSq(sp.position, farPoint) <= eps2 &&
          connections.some((c) => c.nodeId === sp.nodeId && c.kind !== 'run'),
      )
      if (!farPort) {
        if (stretch === 'stretch') return { status: 'stretch' }
        continue
      }
      const lower = nodesById[farPort.nodeId]
      if (!lower || lower.type !== 'duct-fitting') {
        if (stretch === 'stretch') return { status: 'stretch' }
        continue
      }
      const lowerElbow = { ...(lower as DuctFittingNode), ...profilePatch } as DuctFittingNode
      if (lowerElbow.fittingType !== 'elbow') {
        if (stretch === 'stretch') return { status: 'stretch' }
        continue
      }
      const directDir: Point = [-ductPortDir[0], -ductPortDir[1], -ductPortDir[2]]
      const realign = planElbowRealign(lowerElbow, farPort.id, directDir)
      if (!realign) {
        if (stretch === 'stretch') return { status: 'stretch' }
        continue
      }
      const collarOnLiftedLevel: Point = [
        realign.collarPoint[0],
        liftedDuctPoint[1],
        realign.collarPoint[2],
      ]
      if (distToAxisSq(collarOnLiftedLevel, liftedDuctPoint, ductPortDir) > eps2) {
        if (stretch === 'stretch') return { status: 'stretch' }
        continue
      }
      if (Math.abs(realign.collarPoint[1] - liftedDuctPoint[1]) > COINCIDENT_EPS_M) {
        if (stretch === 'stretch') return { status: 'stretch' }
        return { status: 'snap', dy: realign.collarPoint[1] - ductEndPoint[1] }
      }
      return {
        status: 'collapse',
        delete: [fitting.id as AnyNodeId, otherPort.nodeId],
        updates: [
          {
            id: lowerElbow.id,
            data: { ...profilePatch, ...realign.update.data } as Partial<AnyNode>,
          },
        ],
        ductPoint: realign.collarPoint,
      }
    }
    if (stretch === 'stretch') {
      return { status: 'stretch' }
    }
    if (stretch !== 'invalid' || !partnerPath) continue
  }
  return null
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
}): VerticalOffsetResult {
  return planVerticalOffsetsAtDy(args, args.dy, true)
}

function planVerticalOffsetsAtDy(
  args: {
    duct: DuctSegmentNode
    dy: number
    profile: DuctProfile
    connections: PortConnection[]
    scenePorts: ScenePort[]
    nodesById: Record<string, AnyNode>
  },
  routeDy: number,
  allowTransitionSnap: boolean,
): VerticalOffsetResult {
  const { duct, profile, connections, scenePorts, nodesById } = args
  const dy = routeDy
  // No connected ends: nothing to weld, so the caller plain-translates the run.
  if (connections.length === 0) return null
  const leg = fittingLegLength(profileDiameterIn(profile))
  // A connected end that must MINT an offset (two elbows + a real riser) needs
  // room for both legs plus a non-degenerate riser. Checked per-end below, not
  // globally — a partner that's already a vertical riser just STRETCHES and
  // needs no such room, so a tiny lift on a riser-connected run is still valid.
  const hasOffsetRoom = Math.abs(dy) - 2 * leg >= MIN_RISER_M

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
  const deletes: AnyNodeId[] = []
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
    // back along the run axis onto the lifted endpoint. A non-elbow fitting, or
    // an elbow whose re-aim falls out of the buildable range, can't form a clean
    // offset here → the whole lift is invalid (the caller freezes everything and
    // shows a red preview rather than dragging the network up to absorb it).
    if (conn.kind !== 'run') {
      const partner = nodesById[conn.nodeId]
      if (!partner || partner.type !== 'duct-fitting') return { status: 'invalid' }
      const elbow = partner as DuctFittingNode
      if (elbow.fittingType !== 'elbow') return { status: 'invalid' }
      const profilePatch = elbowProfilePatch(profile)
      const profiledElbow = { ...elbow, ...profilePatch } as DuctFittingNode
      const riserAction = fittingRiserAction({
        fitting: profiledElbow,
        matedPortId: partnerPort.id,
        ductPortDir,
        ductEndPoint: endPos,
        liftedDuctPoint: liftedEnd,
        profilePatch,
        dy,
        connections,
        scenePorts,
        nodesById,
        eps2,
      })
      if (riserAction?.status === 'stretch') {
        offsetAny = true
        continue
      }
      if (riserAction?.status === 'collapse') {
        ductPath[endIdx] = riserAction.ductPoint
        followPath[endIdx] = [...startPath[endIdx]!] as Point
        updates.push(...riserAction.updates)
        deletes.push(...riserAction.delete)
        offsetAny = true
        continue
      }
      if (riserAction?.status === 'snap' && allowTransitionSnap) {
        return planVerticalOffsetsAtDy(args, riserAction.dy, false)
      }
      if (riserAction?.status === 'snap') return { status: 'invalid' }
      // Minting the top elbow + riser needs elbow-leg + riser room.
      if (!hasOffsetRoom) return { status: 'invalid' }
      // Re-aim the existing elbow's mated collar to vertical; its other collar
      // (mated to the rest of the run) stays fixed.
      const realign = planElbowRealign(profiledElbow, partnerPort.id, up)
      if (!realign) return { status: 'invalid' }
      // Top elbow: junction plumb above the elbow at the lifted height. Its
      // "existing run" is the riser, whose top port faces UP; the new run
      // leaves back along the run axis (awayBack) onto the lifted endpoint.
      const topJunction: Point = [elbow.position[0], liftedEnd[1], elbow.position[2]]
      const awayBack: Point = [-ductPortDir[0], -ductPortDir[1], -ductPortDir[2]]
      const top = planElbowAtPort(portLike(topJunction, up, duct.system), awayBack, profile)
      if (!top) return { status: 'invalid' }

      fittings.push(top.fitting)
      // Plumb riser: the re-aimed elbow's vertical collar up to the top elbow's
      // riser collar (its trimmedPortPoint) — both at the elbow's XZ.
      risers.push(
        makeRiser(
          realign.collarPoint,
          top.trimmedPortPoint,
          duct,
          rollForRiser(ductPortDir, duct.roll, up),
        ),
      )
      // Re-aim patch for the existing elbow.
      updates.push({
        id: elbow.id,
        data: { ...profilePatch, ...realign.update.data } as Partial<AnyNode>,
      })
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
    const profilePatch = elbowProfilePatch(profile)

    // Aligned vertical riser: the partner run is already plumb and the lift runs
    // along its axis, so there's nothing to turn — just STRETCH it. We leave this
    // end of `followPath` lifted; connectivity-follow decomposes the Y-lift into
    // the riser's (parallel) axis and slides the shared joint up while the far
    // end stays put. No elbows, no new riser, no partner trim. Works at any lift
    // height (a stretch needs no elbow-leg room).
    const partner = nodesById[conn.nodeId]
    const partnerPath = (partner as unknown as { path?: Point[] } | undefined)?.path
    const riserStretch =
      partner?.type === 'duct-segment'
        ? alignedVerticalRiserStretch(partnerPath, endPos, liftedEnd, eps2)
        : null
    if (riserStretch === 'invalid' && partner?.type === 'duct-segment' && partnerPath) {
      const collapse = directRiserCollapseAction({
        riserId: conn.nodeId,
        riserPath: partnerPath,
        riserTopPoint: endPos,
        liftedDuctPoint: liftedEnd,
        ductEndPoint: endPos,
        ductPortDir,
        profilePatch,
        connections,
        scenePorts,
        nodesById,
        eps2,
      })
      if (collapse?.status === 'snap' && allowTransitionSnap) {
        return planVerticalOffsetsAtDy(args, collapse.dy, false)
      }
      if (collapse?.status === 'collapse') {
        ductPath[endIdx] = collapse.ductPoint
        followPath[endIdx] = [...startPath[endIdx]!] as Point
        updates.push(...collapse.updates)
        deletes.push(...collapse.delete)
        offsetAny = true
        continue
      }
      return { status: 'invalid' }
    }
    if (riserStretch === 'invalid') return { status: 'invalid' }
    if (riserStretch === 'stretch') {
      // followPath[endIdx] stays at the lifted point (set above); ductPath too.
      offsetAny = true
      continue
    }

    // Minting an offset here needs elbow-leg + riser room. Without it this end
    // can't form a clean offset at this height → the whole lift is invalid.
    if (!hasOffsetRoom) return { status: 'invalid' }

    // Bottom elbow at the partner joint: turn from the partner's axis up the
    // riser. Partner run trims to its inlet collar.
    const bottom = planElbowAtPort(portLike(endPos, partnerDir, duct.system), up, profile)
    // Top elbow at the lifted endpoint: turn from the run axis down the
    // riser. Lifted run trims to its inlet collar.
    const top = planElbowAtPort(portLike(liftedEnd, ductPortDir, duct.system), down, profile)
    if (!bottom || !top) return { status: 'invalid' }

    fittings.push(bottom.fitting, top.fitting)
    const partnerRoll =
      partner?.type === 'duct-segment' && partner.shape !== 'round' ? partner.roll : 0
    risers.push(
      makeRiser(
        bottom.collarPoint,
        top.collarPoint,
        duct,
        rollForRiser(partnerDir, partnerRoll, up),
      ),
    )
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

  // Every connected end either offset cleanly or there were none to offset.
  // `offsetAny` false here means all ends were open — nothing to weld, plain
  // translate. Otherwise a valid offset plan welds each connected end.
  if (!offsetAny) return null
  return {
    status: 'valid',
    plan: { dy, ductPath, followPath, fittings, risers, updates, delete: deletes },
  }
}
