import {
  DuctFittingNode,
  DuctSegmentNode,
  PipeFittingNode,
  PipeSegmentNode,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { fittingLegLength } from '../duct-fitting/ports'
import {
  ductPortDiameterIn,
  equivalentDiameterIn,
  ovalEquivalentDiameterIn,
} from '../duct-segment/geometry'
import { pipeFittingLegLength } from '../pipe-fitting/ports'
import type { RunBodyHit, ScenePort } from './ports'

/** Turns shallower than this read as a straight continuation — butt-join
 *  the runs instead of minting a fitting. Matches the elbow schema's
 *  minimum angle so the planned fitting is always exactly buildable. */
const MIN_TURN_RAD = (15 * Math.PI) / 180
/** Elbows top out at 90°; anything sharper (doubling back) gets no
 *  fitting. Half a degree of slack absorbs float noise on right angles. */
const MAX_TURN_RAD = (90.5 * Math.PI) / 180

type Point = [number, number, number]

/** Cross-section a planned fitting (and the duct drawing it) carries. */
export type DuctProfile = {
  shape: 'round' | 'rect' | 'oval'
  /** Round size in inches (ignored for rect / oval — the equivalent is derived). */
  diameter: number
  /** Rect / oval profile in inches. */
  width: number
  height: number
}

/** Effective round-size (inches) a profile presents at joints. */
export function profileDiameterIn(profile: DuctProfile): number {
  if (profile.shape === 'rect') {
    return Math.min(48, equivalentDiameterIn(profile.width, profile.height))
  }
  if (profile.shape === 'oval') {
    return Math.min(48, ovalEquivalentDiameterIn(profile.width, profile.height))
  }
  return profile.diameter
}

export type ElbowJointPlan = {
  /** Parsed elbow node, its junction centered ON the drawn corner point,
   *  oriented so the inlet faces the existing run and the outlet faces
   *  the new one. */
  fitting: DuctFittingNode
  /** The elbow's outlet collar — where the new duct should start (or end)
   *  instead of the corner point, so duct meets metal instead of
   *  overlapping the fitting. */
  collarPoint: Point
  /** Where the EXISTING run's endpoint must move (pulled back one leg
   *  from the corner) so the elbow's inlet collar replaces that stretch
   *  of duct — keeping the visual corner exactly where it was drawn. */
  trimmedPortPoint: Point
}

/** Orthonormal basis from a primary direction and a coplanar reference. */
function frame(primary: Vector3, reference: Vector3): Matrix4 | null {
  const x = primary.clone().normalize()
  const z = new Vector3().crossVectors(x, reference)
  if (z.lengthSq() < 1e-10) return null
  z.normalize()
  const y = new Vector3().crossVectors(z, x)
  return new Matrix4().makeBasis(x, y, z)
}

/**
 * Plan the elbow that joins an existing run's open port to a new run
 * leaving the joint along `awayDir`.
 *
 * Geometry: the elbow's local inlet faces -X and its outlet is turned
 * `angle`° in the local XZ plane (see the duct-fitting schema). For a
 * turn of θ between the port's outward direction and `awayDir`, an elbow
 * with `angle = θ` mates both exactly; the rotation is whatever maps the
 * local (inlet, outlet) direction pair onto the world (port, away) pair —
 * which also covers vertical turns (horizontal run → riser), since the
 * mapping is a full 3D rotation, not just yaw.
 *
 * Returns null when no fitting belongs at the joint: near-straight
 * continuation (butt-join is fine), a back-turn sharper than 90°, or a
 * degenerate direction pair.
 */
/**
 * Domain-agnostic corner-joint math: where an elbow-shaped fitting (any
 * kind whose local inlet faces -X with the outlet turned `angle`° in
 * XZ) lands when joining `port` to a run leaving along `awayDir`, with
 * legs of `legM` meters. The junction sits exactly ON the corner; the
 * caller trims the existing run to `trimmedPortPoint` and starts the
 * new one at `collarPoint`.
 */
export type CornerJointGeometry = {
  angleDeg: number
  rotation: Point
  junction: Point
  collarPoint: Point
  trimmedPortPoint: Point
}

export function planCornerJoint(
  port: Pick<ScenePort, 'position' | 'direction'>,
  awayDir: Point,
  legM: number,
): CornerJointGeometry | null {
  const portDir = new Vector3(...port.direction).normalize()
  const away = new Vector3(...awayDir).normalize()
  if (portDir.lengthSq() < 1e-10 || away.lengthSq() < 1e-10) return null

  const turn = portDir.angleTo(away)
  if (turn < MIN_TURN_RAD || turn > MAX_TURN_RAD) return null
  const angleDeg = Math.min(90, (turn * 180) / Math.PI)

  // Rotation mapping the local pair onto the world pair: local +X (the
  // inlet axis, flow direction) → portDir, local outlet → awayDir. Both
  // pairs subtend the same angle, so a shared-plane basis transfer is
  // exact — vertical turns included.
  const outletLocal = new Vector3(Math.cos(turn), 0, Math.sin(turn))
  const localFrame = frame(new Vector3(1, 0, 0), outletLocal)
  const worldFrame = frame(portDir, away)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)

  const junction = new Vector3(...port.position)
  const collar = junction.clone().addScaledVector(away, legM)
  const trimmed = junction.clone().addScaledVector(portDir, -legM)

  return {
    angleDeg,
    rotation: [euler.x, euler.y, euler.z],
    junction: [junction.x, junction.y, junction.z],
    collarPoint: [collar.x, collar.y, collar.z],
    trimmedPortPoint: [trimmed.x, trimmed.y, trimmed.z],
  }
}

export function planElbowAtPort(
  port: ScenePort,
  awayDir: Point,
  profile: DuctProfile,
): ElbowJointPlan | null {
  const joint = planCornerJoint(port, awayDir, fittingLegLength(profileDiameterIn(profile)))
  if (!joint) return null

  const system = port.system === 'return' ? 'return' : 'supply'
  // Built from the schema directly (defaults fill the rest) — importing
  // the fitting's definition here would drag the editor package into the
  // module graph, which test runners and non-editor embedders can't load.
  const fitting = DuctFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Elbow',
    fittingType: 'elbow',
    shape: profile.shape,
    width: profile.width,
    height: profile.height,
    angle: joint.angleDeg,
    diameter: profileDiameterIn(profile),
    diameter2: profileDiameterIn(profile),
    // Corner elbows are sheet metal even on flex runs (adjustable elbows).
    ductMaterial: 'sheet-metal',
    system,
    position: joint.junction,
    rotation: joint.rotation,
  })

  return {
    fitting,
    collarPoint: joint.collarPoint,
    trimmedPortPoint: joint.trimmedPortPoint,
  }
}

// ─── Tee taps (branch off a trunk's body) ────────────────────────────

export type TeeTapPlan = {
  /** Parsed tee node, its junction centered ON the tap point, run legs
   *  along the trunk and branch collar toward the new run. */
  fitting: DuctFittingNode
  /** The tee's branch collar — where the new duct should start. */
  branchCollar: Point
  /** Trunk rewritten to END one run-leg before the tap point. */
  trunkUpdate: { id: DuctSegmentNode['id']; data: { path: Point[] } }
  /** New run carrying the rest of the trunk, starting one run-leg after
   *  the tap point. Created alongside the tee. */
  trunkTail: DuctSegmentNode
}

/**
 * Plan the tee that taps a branch off the SIDE of an existing run.
 *
 * The trunk is split at the tap point: the original node keeps the
 * upstream half (trimmed one leg short), a new duct-segment node carries
 * the downstream half (starting one leg after), and the tee's run legs
 * bridge the gap with its junction exactly on the centerline hit. The
 * branch collar follows `awayDir`: the tee becomes a lateral whose
 * `branchAngle` (clamped to the buildable 45–135° range) matches the turn
 * the drawn run makes off the trunk, so the new duct continues straight
 * out of the collar instead of kinking square.
 *
 * Returns null when the tap can't be built: too close to the segment's
 * ends (no room for the run legs — join the end port instead), or the
 * branch direction is parallel to the trunk.
 */
export function planTeeAtRunBody(
  trunk: DuctSegmentNode,
  hit: RunBodyHit,
  awayDir: Point,
  branch: DuctProfile,
): TeeTapPlan | null {
  const a = trunk.path[hit.segmentIndex]
  const b = trunk.path[hit.segmentIndex + 1]
  if (!a || !b) return null
  const axis = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  if (axis.lengthSq() < 1e-10) return null
  axis.normalize()

  // The branch FOLLOWS the drawn run's angle: the tee becomes a lateral
  // whose `branchAngle` matches the actual turn the new run makes off the
  // trunk, instead of forcing a square tap and kinking the drawn duct.
  // `branchDir` is the drawn direction's component square to the trunk —
  // it sets the PLANE the branch leans in; the lean amount comes from how
  // much of `away` runs along the trunk vs. across it.
  const away = new Vector3(...awayDir).normalize()
  if (away.lengthSq() < 1e-10) return null
  const branchDir = away.clone().addScaledVector(axis, -away.dot(axis))
  if (branchDir.lengthSq() < 1e-6) return null
  branchDir.normalize()

  // `branchAngle` is measured off the +X (outlet / downstream) axis in the
  // tee's local XZ plane, where +Z is the branch's square direction. So
  // the angle is atan2(across-trunk component, along-trunk component) of
  // the drawn run — 90° when square, <90° leaning downstream, >90° leaning
  // upstream. Clamped to the schema's buildable 45–135° lateral range.
  const acrossLen = Math.sqrt(Math.max(0, 1 - away.dot(axis) ** 2))
  const branchAngleDeg = Math.min(
    135,
    Math.max(45, (Math.atan2(acrossLen, away.dot(axis)) * 180) / Math.PI),
  )
  const phi = (branchAngleDeg * Math.PI) / 180
  // Actual branch outward direction at the (possibly clamped) angle — the
  // new run starts at its collar. When unclamped this equals `away`, so
  // the drawn duct continues straight out of the tee.
  const branchOutDir = axis
    .clone()
    .multiplyScalar(Math.cos(phi))
    .addScaledVector(branchDir, Math.sin(phi))
    .normalize()

  // Room check: both run legs must fit inside the hit segment with a
  // margin of real duct on each side.
  // Rect trunks present their area-equivalent round size at joints
  // (clamped to the fitting schema's 48" ceiling).
  const trunkDiameterIn = Math.min(48, ductPortDiameterIn(trunk))
  const branchDiameterIn = Math.min(48, profileDiameterIn(branch))
  const legRun = fittingLegLength(trunkDiameterIn)
  const legBranch = fittingLegLength(branchDiameterIn)
  const P = new Vector3(...hit.point)
  const upstream = P.distanceTo(new Vector3(...a))
  const downstream = P.distanceTo(new Vector3(...b))
  const MIN_STUB = 0.08
  if (upstream < legRun + MIN_STUB || downstream < legRun + MIN_STUB) return null

  // Local +X (the run) → axis, local +Z (the branch plane) → branchDir.
  // Both pairs are perpendicular, so the basis transfer is exact and the
  // local branch leg (cos φ, sin φ) lands on `branchOutDir` in world.
  const localFrame = frame(new Vector3(1, 0, 0), new Vector3(0, 0, 1))
  const worldFrame = frame(axis, branchDir)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)

  const inletTrim = P.clone().addScaledVector(axis, -legRun)
  const outletTrim = P.clone().addScaledVector(axis, legRun)
  const collar = P.clone().addScaledVector(branchOutDir, legBranch)

  const fitting = DuctFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Tee',
    fittingType: 'tee',
    shape: trunk.shape,
    width: trunk.width,
    height: trunk.height,
    diameter: trunkDiameterIn,
    shape2: branch.shape,
    width2: branch.width,
    height2: branch.height,
    diameter2: branchDiameterIn,
    branchAngle: branchAngleDeg,
    ductMaterial: 'sheet-metal',
    system: trunk.system,
    position: [P.x, P.y, P.z],
    rotation: [euler.x, euler.y, euler.z],
  })

  // Split the polyline: original keeps the upstream points + the inlet
  // trim; the tail node starts at the outlet trim and carries the rest.
  const upstreamPath: Point[] = [
    ...trunk.path.slice(0, hit.segmentIndex + 1).map((p) => [...p] as Point),
    [inletTrim.x, inletTrim.y, inletTrim.z],
  ]
  const tailPath: Point[] = [
    [outletTrim.x, outletTrim.y, outletTrim.z],
    ...trunk.path.slice(hit.segmentIndex + 1).map((p) => [...p] as Point),
  ]

  const trunkTail = DuctSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: trunk.name ?? 'Duct run',
    path: tailPath,
    shape: trunk.shape,
    diameter: trunk.diameter,
    width: trunk.width,
    height: trunk.height,
    roll: trunk.roll,
    ductMaterial: trunk.ductMaterial,
    insulated: trunk.insulated,
    insulationR: trunk.insulationR,
    system: trunk.system,
  })

  return {
    fitting,
    branchCollar: [collar.x, collar.y, collar.z],
    trunkUpdate: { id: trunk.id, data: { path: upstreamPath } },
    trunkTail,
  }
}

// ─── Cross taps (drawn run passes THROUGH a trunk's body) ────────────

export type CrossTapPlan = {
  /** Parsed cross node, junction ON the crossing point, run legs along
   *  the trunk and two opposed branch legs along the drawn run. */
  fitting: DuctFittingNode
  /** Branch collar on the START side of the drawn run — the first half
   *  of the drawn duct ENDS here. */
  branchCollarNear: Point
  /** Branch collar on the END side of the drawn run — the second half
   *  of the drawn duct STARTS here. */
  branchCollarFar: Point
  /** Trunk rewritten to END one run-leg before the crossing. */
  trunkUpdate: { id: DuctSegmentNode['id']; data: { path: Point[] } }
  /** New run carrying the rest of the trunk, starting one run-leg past
   *  the crossing. Created alongside the cross. */
  trunkTail: DuctSegmentNode
}

/**
 * Plan the four-way cross where a drawn run passes straight THROUGH the
 * SIDE of an existing run. Like a tee tap, the trunk is split at the
 * crossing (original keeps the upstream half, a new node carries the
 * downstream half, both pulled one run-leg back). The drawn run is split
 * by the CALLER into two halves that meet the cross's two opposed branch
 * collars — `branchCollarNear` toward `awayDir`'s origin (the drawn
 * start) and `branchCollarFar` along `awayDir` (the drawn end).
 *
 * `awayDir` is the drawn run's direction (start → end). Its component
 * perpendicular to the trunk axis sets the branch axis; a drawn run that
 * isn't square to the trunk still gets a square cross (the off-square
 * lead-ins are absorbed by the drawn duct halves). Returns null when the
 * crossing is too near a trunk end (no room for the run legs) or the
 * drawn run is parallel to the trunk.
 */
export function planCrossAtRunBody(
  trunk: DuctSegmentNode,
  hit: RunBodyHit,
  awayDir: Point,
  branch: DuctProfile,
): CrossTapPlan | null {
  const a = trunk.path[hit.segmentIndex]
  const b = trunk.path[hit.segmentIndex + 1]
  if (!a || !b) return null
  const axis = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  if (axis.lengthSq() < 1e-10) return null
  axis.normalize()

  // Branch axis: the drawn direction projected square to the trunk.
  const away = new Vector3(...awayDir)
  const branchDir = away.clone().addScaledVector(axis, -away.dot(axis))
  if (branchDir.lengthSq() < 1e-6) return null
  branchDir.normalize()

  const trunkDiameterIn = Math.min(48, ductPortDiameterIn(trunk))
  const branchDiameterIn = Math.min(48, profileDiameterIn(branch))
  const legRun = fittingLegLength(trunkDiameterIn)
  const legBranch = fittingLegLength(branchDiameterIn)
  const P = new Vector3(...hit.point)
  const upstream = P.distanceTo(new Vector3(...a))
  const downstream = P.distanceTo(new Vector3(...b))
  const MIN_STUB = 0.08
  if (upstream < legRun + MIN_STUB || downstream < legRun + MIN_STUB) return null

  // Local +X (the run) → axis, local +Z (the branch +Z leg) → branchDir.
  const localFrame = frame(new Vector3(1, 0, 0), new Vector3(0, 0, 1))
  const worldFrame = frame(axis, branchDir)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)

  const inletTrim = P.clone().addScaledVector(axis, -legRun)
  const outletTrim = P.clone().addScaledVector(axis, legRun)
  // +Z branch (`branch`) faces along branchDir = the drawn END side;
  // -Z branch (`branch2`) faces the drawn START side.
  const collarFar = P.clone().addScaledVector(branchDir, legBranch)
  const collarNear = P.clone().addScaledVector(branchDir, -legBranch)

  const fitting = DuctFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Cross',
    fittingType: 'cross',
    shape: trunk.shape,
    width: trunk.width,
    height: trunk.height,
    diameter: trunkDiameterIn,
    shape2: branch.shape,
    width2: branch.width,
    height2: branch.height,
    diameter2: branchDiameterIn,
    ductMaterial: 'sheet-metal',
    system: trunk.system,
    position: [P.x, P.y, P.z],
    rotation: [euler.x, euler.y, euler.z],
  })

  const upstreamPath: Point[] = [
    ...trunk.path.slice(0, hit.segmentIndex + 1).map((p) => [...p] as Point),
    [inletTrim.x, inletTrim.y, inletTrim.z],
  ]
  const tailPath: Point[] = [
    [outletTrim.x, outletTrim.y, outletTrim.z],
    ...trunk.path.slice(hit.segmentIndex + 1).map((p) => [...p] as Point),
  ]

  const trunkTail = DuctSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: trunk.name ?? 'Duct run',
    path: tailPath,
    shape: trunk.shape,
    diameter: trunk.diameter,
    width: trunk.width,
    height: trunk.height,
    roll: trunk.roll,
    ductMaterial: trunk.ductMaterial,
    insulated: trunk.insulated,
    insulationR: trunk.insulationR,
    system: trunk.system,
  })

  return {
    fitting,
    branchCollarNear: [collarNear.x, collarNear.y, collarNear.z],
    branchCollarFar: [collarFar.x, collarFar.y, collarFar.z],
    trunkUpdate: { id: trunk.id, data: { path: upstreamPath } },
    trunkTail,
  }
}

// ─── Elbow realignment (run drawn onto an existing fitting's collar) ──

export type ElbowRealignPlan = {
  /** Patch for the existing elbow: new turn angle + orientation. */
  update: { id: DuctFittingNode['id']; data: { angle: number; rotation: Point } }
  /** Where the free collar lands — the new duct starts (or ends) here. */
  collarPoint: Point
}

export type PipeElbowRealignPlan = {
  update: { id: PipeFittingNode['id']; data: { angle: number; rotation: Point } }
  collarPoint: Point
}

/**
 * Shared elbow re-aim geometry for duct AND pipe elbows — both share the
 * exact same local convention (inlet -X, outlet turned `angle`° in XZ,
 * 15–90° buildable range), so only the collar leg length differs.
 *
 * The junction stays put and the OTHER collar keeps its exact position +
 * direction (it's mated to something), while the snapped collar swings to
 * face `awayDir` — the elbow's `angle` adjusts to whatever turn that
 * requires. Geometry: with the fixed collar's outward direction f and the
 * desired free direction `awayDir`, the elbow's local inlet/outlet pair
 * subtends 180° − angle, so the new turn is θ = 180° − ∠(f, away).
 * Buildable only while θ stays in 15–90° — otherwise null.
 */
function planElbowRealignCore(
  elbow: { fittingType: string; rotation: Point; angle: number; position: Point },
  snappedPortId: string,
  awayDir: Point,
  leg: number,
): { angle: number; rotation: Point; collarPoint: Point } | null {
  if (elbow.fittingType !== 'elbow') return null
  if (snappedPortId !== 'inlet' && snappedPortId !== 'outlet') return null

  const away = new Vector3(...awayDir)
  if (away.lengthSq() < 1e-10) return null
  away.normalize()

  // Current world directions of both collars.
  const currentRotation = new Quaternion().setFromEuler(
    new Euler(elbow.rotation[0], elbow.rotation[1], elbow.rotation[2]),
  )
  const turnCur = (elbow.angle * Math.PI) / 180
  const inletWorld = new Vector3(-1, 0, 0).applyQuaternion(currentRotation)
  const outletWorld = new Vector3(Math.cos(turnCur), 0, Math.sin(turnCur)).applyQuaternion(
    currentRotation,
  )
  const fixedWorld = snappedPortId === 'inlet' ? outletWorld : inletWorld

  // New turn from the fixed collar / free collar pair. Unlike fresh-fitting
  // creation (which butt-joins near-straight runs rather than minting a flat
  // elbow), an EXISTING elbow may flatten all the way to 0° — a straight
  // coupling — when its run is dragged into line, so only the upper bound
  // guards here.
  const spread = fixedWorld.angleTo(away)
  const turnNew = Math.PI - spread
  if (turnNew > MAX_TURN_RAD) return null

  // Local outward pair at the new angle, ordered (fixed, free) to match
  // the world pair.
  const inletLocal = new Vector3(-1, 0, 0)
  const outletLocal = new Vector3(Math.cos(turnNew), 0, Math.sin(turnNew))
  const fixedLocal = snappedPortId === 'inlet' ? outletLocal : inletLocal
  const freeLocal = snappedPortId === 'inlet' ? inletLocal : outletLocal

  const localFrame = frame(fixedLocal, freeLocal)
  const worldFrame = frame(fixedWorld, away)
  // At (near-)straight the two collars are collinear, so the bend plane is
  // undefined and `frame()` returns null. Map the fixed collar's local axis
  // onto its world direction instead; the free collar (antiparallel) lands
  // on `away` for free, and a straight coupling's roll is arbitrary.
  const rotation =
    localFrame && worldFrame
      ? new Quaternion().setFromRotationMatrix(worldFrame.multiply(localFrame.transpose()))
      : new Quaternion().setFromUnitVectors(fixedLocal, fixedWorld)
  const euler = new Euler().setFromQuaternion(rotation)

  const collar = new Vector3(...elbow.position).addScaledVector(away, leg)

  return {
    angle: Math.max(0, Math.min(90, (turnNew * 180) / Math.PI)),
    rotation: [euler.x, euler.y, euler.z],
    collarPoint: [collar.x, collar.y, collar.z],
  }
}

/** Re-aim a DUCT elbow whose open collar a new run just snapped onto. */
export function planElbowRealign(
  elbow: DuctFittingNode,
  snappedPortId: string,
  awayDir: Point,
): ElbowRealignPlan | null {
  const core = planElbowRealignCore(elbow, snappedPortId, awayDir, fittingLegLength(elbow.diameter))
  if (!core) return null
  return {
    update: { id: elbow.id, data: { angle: core.angle, rotation: core.rotation } },
    collarPoint: core.collarPoint,
  }
}

/** Re-aim a DWV PIPE elbow — same geometry, pipe collar leg length. */
export function planPipeElbowRealign(
  elbow: PipeFittingNode,
  snappedPortId: string,
  awayDir: Point,
): PipeElbowRealignPlan | null {
  const core = planElbowRealignCore(
    elbow,
    snappedPortId,
    awayDir,
    pipeFittingLegLength(elbow.diameter),
  )
  if (!core) return null
  return {
    update: { id: elbow.id, data: { angle: core.angle, rotation: core.rotation } },
    collarPoint: core.collarPoint,
  }
}

// ─── Tee branch re-aim (run dragged off an existing tee's branch) ────

export type TeeBranchRealignPlan = {
  /** Patch for the existing tee: new branch lean angle. The run axis and
   *  the tee's orientation stay fixed (inlet / outlet stay mated to the
   *  trunk) — only `branchAngle` changes. */
  update: { id: DuctFittingNode['id']; data: { branchAngle: number } }
  /** Where the branch collar lands at the new angle — the dragged run's
   *  mated end rides here. */
  collarPoint: Point
}

/**
 * Re-aim a duct TEE's branch to follow a run dragged off its branch collar.
 *
 * Unlike the elbow (which re-orients its whole body), a tee's run legs stay
 * mated to the trunk, so the body orientation is FIXED: the branch can only
 * swing within the tee's local XZ plane (local +X = run axis, +Z = the
 * square branch direction). `awayDir` (junction → dragged end) is projected
 * onto that plane and read as the lean angle off +X — 90° square, <90°
 * leaning downstream toward the outlet, >90° upstream toward the inlet —
 * clamped to the schema's buildable 45–135° lateral range.
 */
export function planTeeBranchRealign(
  tee: DuctFittingNode,
  awayDir: Point,
): TeeBranchRealignPlan | null {
  if (tee.fittingType !== 'tee') return null
  const away = new Vector3(...awayDir)
  if (away.lengthSq() < 1e-10) return null
  away.normalize()

  const rot = new Quaternion().setFromEuler(
    new Euler(tee.rotation[0], tee.rotation[1], tee.rotation[2]),
  )
  const runAxis = new Vector3(1, 0, 0).applyQuaternion(rot)
  const squareDir = new Vector3(0, 0, 1).applyQuaternion(rot)
  const ax = away.dot(runAxis)
  const az = away.dot(squareDir)
  // Drag straight along the run axis (no square component) leaves the lean
  // undefined — hold the frame.
  if (Math.abs(ax) < 1e-9 && Math.abs(az) < 1e-9) return null

  const branchAngleDeg = Math.min(135, Math.max(45, (Math.atan2(az, ax) * 180) / Math.PI))
  const phi = (branchAngleDeg * Math.PI) / 180
  const branchDir = runAxis
    .clone()
    .multiplyScalar(Math.cos(phi))
    .addScaledVector(squareDir, Math.sin(phi))
    .normalize()
  const collar = new Vector3(...tee.position).addScaledVector(
    branchDir,
    fittingLegLength(tee.diameter2),
  )

  return {
    update: { id: tee.id, data: { branchAngle: branchAngleDeg } },
    collarPoint: [collar.x, collar.y, collar.z],
  }
}

// ─── DWV pipe joints ─────────────────────────────────────────────────

export type PipeElbowPlan = {
  fitting: PipeFittingNode
  collarPoint: Point
  trimmedPortPoint: Point
}

/**
 * Elbow (bend) joining an existing DWV run's open port to a new run —
 * same corner geometry as the duct elbow, minted as a pipe fitting.
 */
export function planPipeElbowAtPort(
  port: ScenePort,
  awayDir: Point,
  diameterIn: number,
  pipeMaterial: PipeFittingNode['pipeMaterial'] = 'pvc',
): PipeElbowPlan | null {
  const joint = planCornerJoint(port, awayDir, pipeFittingLegLength(diameterIn))
  if (!joint) return null

  const fitting = PipeFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Bend',
    fittingType: 'elbow',
    angle: joint.angleDeg,
    diameter: diameterIn,
    diameter2: diameterIn,
    pipeMaterial,
    system: port.system === 'vent' ? 'vent' : 'waste',
    position: joint.junction,
    rotation: joint.rotation,
  })

  return {
    fitting,
    collarPoint: joint.collarPoint,
    trimmedPortPoint: joint.trimmedPortPoint,
  }
}

export type PipeBranchTapPlan = {
  /** Parsed wye / sanitary tee, junction ON the tap point. */
  fitting: PipeFittingNode
  /** The branch collar — where the new run starts. */
  branchCollar: Point
  /** Tapped run rewritten to END one run-leg before the tap. */
  runUpdate: { id: PipeSegmentNode['id']; data: { path: Point[] } }
  /** New run carrying the rest of the tapped run. */
  runTail: PipeSegmentNode
}

/**
 * Plan the branch fitting that taps a new run into the SIDE of an
 * existing DWV run — a **sanitary tee**: the branch enters SQUARE off the
 * run (same T as the duct tee tap), facing the drawn branch's side.
 *
 * The run splits like a duct tee tap: original keeps the upstream half,
 * a new node carries the downstream half, both trimmed one run-leg from
 * the tap point.
 */
export function planPipeBranchTap(
  run: PipeSegmentNode,
  hit: RunBodyHit,
  awayDir: Point,
  branchDiameterIn: number,
): PipeBranchTapPlan | null {
  const a = run.path[hit.segmentIndex]
  const b = run.path[hit.segmentIndex + 1]
  if (!a || !b) return null
  const axis = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  if (axis.lengthSq() < 1e-10) return null
  axis.normalize()

  // Branch axis: the drawn direction projected square to the run, so the
  // tee enters perpendicular regardless of the lead-in angle.
  const away = new Vector3(...awayDir)
  const branchDir = away.clone().addScaledVector(axis, -away.dot(axis))
  if (branchDir.lengthSq() < 1e-6) return null
  branchDir.normalize()

  const legRun = pipeFittingLegLength(run.diameter)
  const legBranch = pipeFittingLegLength(branchDiameterIn)
  const P = new Vector3(...hit.point)
  const upstream = P.distanceTo(new Vector3(...a))
  const downstream = P.distanceTo(new Vector3(...b))
  const MIN_STUB = 0.05
  if (upstream < legRun + MIN_STUB || downstream < legRun + MIN_STUB) return null

  // Local +X (run) → axis, local +Z (branch) → branchDir. Both pairs are
  // perpendicular, so the basis transfer is exact and the santee's square
  // +Z branch lands on branchDir.
  const localFrame = frame(new Vector3(1, 0, 0), new Vector3(0, 0, 1))
  const worldFrame = frame(axis, branchDir)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)

  const inletTrim = P.clone().addScaledVector(axis, -legRun)
  const outletTrim = P.clone().addScaledVector(axis, legRun)
  const collar = P.clone().addScaledVector(branchDir, legBranch)

  const fitting = PipeFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Sanitary tee',
    fittingType: 'sanitary-tee',
    diameter: run.diameter,
    diameter2: branchDiameterIn,
    pipeMaterial: run.pipeMaterial,
    system: run.system,
    position: [P.x, P.y, P.z],
    rotation: [euler.x, euler.y, euler.z],
  })

  const upstreamPath: Point[] = [
    ...run.path.slice(0, hit.segmentIndex + 1).map((p) => [...p] as Point),
    [inletTrim.x, inletTrim.y, inletTrim.z],
  ]
  const tailPath: Point[] = [
    [outletTrim.x, outletTrim.y, outletTrim.z],
    ...run.path.slice(hit.segmentIndex + 1).map((p) => [...p] as Point),
  ]

  const runTail = PipeSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: run.name ?? 'Drain',
    path: tailPath,
    diameter: run.diameter,
    pipeMaterial: run.pipeMaterial,
    system: run.system,
  })

  return {
    fitting,
    branchCollar: [collar.x, collar.y, collar.z],
    runUpdate: { id: run.id, data: { path: upstreamPath } },
    runTail,
  }
}

export type PipeCrossTapPlan = {
  /** Parsed cross node, junction ON the crossing point, run legs along
   *  the run and two opposed branch legs along the drawn run. */
  fitting: PipeFittingNode
  /** Branch collar on the START side of the drawn run — the first half
   *  of the drawn pipe ENDS here. */
  branchCollarNear: Point
  /** Branch collar on the END side of the drawn run — the second half
   *  of the drawn pipe STARTS here. */
  branchCollarFar: Point
  /** Tapped run rewritten to END one run-leg before the crossing. */
  runUpdate: { id: PipeSegmentNode['id']; data: { path: Point[] } }
  /** New run carrying the rest of the tapped run. */
  runTail: PipeSegmentNode
}

/**
 * Plan the four-way DWV cross where a drawn run passes straight THROUGH
 * the SIDE of an existing run — the pipe sibling of `planCrossAtRunBody`.
 * The run splits at the crossing (original keeps the upstream half, a new
 * node carries the downstream half, both pulled one run-leg back). The
 * drawn run is split by the CALLER into two halves meeting the cross's
 * opposed branch collars — `branchCollarNear` toward the drawn start,
 * `branchCollarFar` along the drawn end. Returns null when the crossing
 * is too near a run end or the drawn run is parallel to the run.
 */
export function planPipeCrossAtRunBody(
  run: PipeSegmentNode,
  hit: RunBodyHit,
  awayDir: Point,
  branchDiameterIn: number,
): PipeCrossTapPlan | null {
  const a = run.path[hit.segmentIndex]
  const b = run.path[hit.segmentIndex + 1]
  if (!a || !b) return null
  const axis = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  if (axis.lengthSq() < 1e-10) return null
  axis.normalize()

  // Branch axis: the drawn direction projected square to the run.
  const away = new Vector3(...awayDir)
  const branchDir = away.clone().addScaledVector(axis, -away.dot(axis))
  if (branchDir.lengthSq() < 1e-6) return null
  branchDir.normalize()

  const legRun = pipeFittingLegLength(run.diameter)
  const legBranch = pipeFittingLegLength(branchDiameterIn)
  const P = new Vector3(...hit.point)
  const upstream = P.distanceTo(new Vector3(...a))
  const downstream = P.distanceTo(new Vector3(...b))
  const MIN_STUB = 0.05
  if (upstream < legRun + MIN_STUB || downstream < legRun + MIN_STUB) return null

  // Local +X (run) → axis, local +Z (the branch +Z leg) → branchDir.
  const localFrame = frame(new Vector3(1, 0, 0), new Vector3(0, 0, 1))
  const worldFrame = frame(axis, branchDir)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)

  const inletTrim = P.clone().addScaledVector(axis, -legRun)
  const outletTrim = P.clone().addScaledVector(axis, legRun)
  // +Z branch faces along branchDir = the drawn END side; -Z branch2
  // faces the drawn START side.
  const collarFar = P.clone().addScaledVector(branchDir, legBranch)
  const collarNear = P.clone().addScaledVector(branchDir, -legBranch)

  const fitting = PipeFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Cross',
    fittingType: 'cross',
    diameter: run.diameter,
    diameter2: branchDiameterIn,
    pipeMaterial: run.pipeMaterial,
    system: run.system,
    position: [P.x, P.y, P.z],
    rotation: [euler.x, euler.y, euler.z],
  })

  const upstreamPath: Point[] = [
    ...run.path.slice(0, hit.segmentIndex + 1).map((p) => [...p] as Point),
    [inletTrim.x, inletTrim.y, inletTrim.z],
  ]
  const tailPath: Point[] = [
    [outletTrim.x, outletTrim.y, outletTrim.z],
    ...run.path.slice(hit.segmentIndex + 1).map((p) => [...p] as Point),
  ]

  const runTail = PipeSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: run.name ?? 'Drain',
    path: tailPath,
    diameter: run.diameter,
    pipeMaterial: run.pipeMaterial,
    system: run.system,
  })

  return {
    fitting,
    branchCollarNear: [collarNear.x, collarNear.y, collarNear.z],
    branchCollarFar: [collarFar.x, collarFar.y, collarFar.z],
    runUpdate: { id: run.id, data: { path: upstreamPath } },
    runTail,
  }
}
