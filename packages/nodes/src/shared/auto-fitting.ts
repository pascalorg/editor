import {
  DuctFittingNode,
  DuctSegmentNode,
  PipeFittingNode,
  PipeSegmentNode,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { fittingLegLength } from '../duct-fitting/ports'
import { ductPortDiameterIn, equivalentDiameterIn } from '../duct-segment/geometry'
import { pipeFittingLegLength, WYE_BRANCH_RAD } from '../pipe-fitting/ports'
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
  shape: 'round' | 'rect'
  /** Round size in inches (ignored for rect — the equivalent is derived). */
  diameter: number
  /** Rect profile in inches. */
  width: number
  height: number
}

/** Effective round-size (inches) a profile presents at joints. */
export function profileDiameterIn(profile: DuctProfile): number {
  return profile.shape === 'rect'
    ? Math.min(48, equivalentDiameterIn(profile.width, profile.height))
    : profile.diameter
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
 * branch collar points along `awayDir` projected perpendicular to the
 * trunk axis — a tee's branch is square to its run, so a 45° drawn
 * branch leaves square and the drawn duct continues from the collar.
 *
 * Returns null when the tap can't be built: too close to the segment's
 * ends (no room for the run legs — join the end port instead), or the
 * branch direction is parallel to the trunk.
 */
export function planTeeAtRunBody(
  trunk: DuctSegmentNode,
  hit: RunBodyHit,
  awayDir: Point,
  branchDiameterIn: number,
): TeeTapPlan | null {
  const a = trunk.path[hit.segmentIndex]
  const b = trunk.path[hit.segmentIndex + 1]
  if (!a || !b) return null
  const axis = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  if (axis.lengthSq() < 1e-10) return null
  axis.normalize()

  // Branch leaves square to the run: project the drawn direction onto
  // the plane perpendicular to the trunk axis.
  const away = new Vector3(...awayDir)
  const branchDir = away.clone().addScaledVector(axis, -away.dot(axis))
  if (branchDir.lengthSq() < 1e-6) return null
  branchDir.normalize()

  // Room check: both run legs must fit inside the hit segment with a
  // margin of real duct on each side.
  // Rect trunks present their area-equivalent round size at joints
  // (clamped to the fitting schema's 48" ceiling).
  const trunkDiameterIn = Math.min(48, ductPortDiameterIn(trunk))
  const legRun = fittingLegLength(trunkDiameterIn)
  const legBranch = fittingLegLength(branchDiameterIn)
  const P = new Vector3(...hit.point)
  const upstream = P.distanceTo(new Vector3(...a))
  const downstream = P.distanceTo(new Vector3(...b))
  const MIN_STUB = 0.08
  if (upstream < legRun + MIN_STUB || downstream < legRun + MIN_STUB) return null

  // Local +X (the run) → axis, local +Z (the branch) → branchDir. Both
  // pairs are perpendicular, so the basis transfer is exact.
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
    diameter2: branchDiameterIn,
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
    ductMaterial: trunk.ductMaterial,
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

// ─── Elbow realignment (run drawn onto an existing fitting's collar) ──

export type ElbowRealignPlan = {
  /** Patch for the existing elbow: new turn angle + orientation. */
  update: { id: DuctFittingNode['id']; data: { angle: number; rotation: Point } }
  /** Where the free collar lands — the new duct starts (or ends) here. */
  collarPoint: Point
}

/**
 * Re-aim an existing elbow whose open collar a new run just snapped
 * onto. The junction stays put and the OTHER collar keeps its exact
 * position + direction (it's mated to something), while the snapped
 * collar swings to face the incoming run — the elbow's `angle` adjusts
 * to whatever turn that requires.
 *
 * Geometry: with the fixed collar's outward direction f and the desired
 * free direction `awayDir`, the elbow's local inlet/outlet pair subtends
 * 180° − angle, so the new turn is θ = 180° − ∠(f, away). Buildable only
 * while θ stays in the elbow's 15–90° range — otherwise null and the
 * caller leaves the joint as a plain butt joint.
 */
export function planElbowRealign(
  elbow: DuctFittingNode,
  snappedPortId: string,
  awayDir: Point,
): ElbowRealignPlan | null {
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

  // New turn from the fixed collar / free collar pair.
  const spread = fixedWorld.angleTo(away)
  const turnNew = Math.PI - spread
  if (turnNew < MIN_TURN_RAD || turnNew > MAX_TURN_RAD) return null

  // Local outward pair at the new angle, ordered (fixed, free) to match
  // the world pair.
  const inletLocal = new Vector3(-1, 0, 0)
  const outletLocal = new Vector3(Math.cos(turnNew), 0, Math.sin(turnNew))
  const fixedLocal = snappedPortId === 'inlet' ? outletLocal : inletLocal
  const freeLocal = snappedPortId === 'inlet' ? inletLocal : outletLocal

  const localFrame = frame(fixedLocal, freeLocal)
  const worldFrame = frame(fixedWorld, away)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)

  const leg = fittingLegLength(elbow.diameter)
  const collar = new Vector3(...elbow.position).addScaledVector(away, leg)

  return {
    update: {
      id: elbow.id,
      data: {
        angle: Math.min(90, (turnNew * 180) / Math.PI),
        rotation: [euler.x, euler.y, euler.z],
      },
    },
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

/** A run steeper than this reads as a vertical stack — branch entries
 *  use a sanitary tee instead of a wye. */
const STACK_AXIS_Y = 0.7

/**
 * Plan the branch fitting that taps a new run into the SIDE of an
 * existing DWV run — plumbing's code-correct joints:
 *
 *   - Horizontal drain → **wye**: the branch enters at 45°, leaning
 *     DOWNSTREAM (along the run's draw direction, which is its fall
 *     direction), so flow merges instead of colliding.
 *   - Vertical stack → **sanitary tee**: the branch enters square.
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

  const away = new Vector3(...awayDir)
  const perp = away.clone().addScaledVector(axis, -away.dot(axis))
  if (perp.lengthSq() < 1e-6) return null
  perp.normalize()

  const isStack = Math.abs(axis.y) > STACK_AXIS_Y
  const fittingType = isStack ? 'sanitary-tee' : 'wye'
  const branchDir = isStack
    ? perp.clone()
    : axis
        .clone()
        .multiplyScalar(Math.cos(WYE_BRANCH_RAD))
        .addScaledVector(perp, Math.sin(WYE_BRANCH_RAD))
        .normalize()

  const legRun = pipeFittingLegLength(run.diameter)
  const legBranch = pipeFittingLegLength(branchDiameterIn)
  const P = new Vector3(...hit.point)
  const upstream = P.distanceTo(new Vector3(...a))
  const downstream = P.distanceTo(new Vector3(...b))
  const MIN_STUB = 0.05
  if (upstream < legRun + MIN_STUB || downstream < legRun + MIN_STUB) return null

  // Local +X (run) → axis, local +Z (branch plane) → perp. The wye's
  // 45° local branch maps onto branchDir automatically.
  const localFrame = frame(new Vector3(1, 0, 0), new Vector3(0, 0, 1))
  const worldFrame = frame(axis, perp)
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
    name: isStack ? 'Sanitary tee' : 'Wye',
    fittingType,
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
