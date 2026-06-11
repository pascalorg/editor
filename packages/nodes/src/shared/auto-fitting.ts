import { DuctFittingNode, DuctSegmentNode } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { fittingLegLength } from '../duct-fitting/ports'
import type { RunBodyHit, ScenePort } from './ports'

/** Turns shallower than this read as a straight continuation — butt-join
 *  the runs instead of minting a fitting. Matches the elbow schema's
 *  minimum angle so the planned fitting is always exactly buildable. */
const MIN_TURN_RAD = (15 * Math.PI) / 180
/** Elbows top out at 90°; anything sharper (doubling back) gets no
 *  fitting. Half a degree of slack absorbs float noise on right angles. */
const MAX_TURN_RAD = (90.5 * Math.PI) / 180

type Point = [number, number, number]

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
export function planElbowAtPort(
  port: ScenePort,
  awayDir: Point,
  diameterIn: number,
): ElbowJointPlan | null {
  const portDir = new Vector3(...port.direction).normalize()
  const away = new Vector3(...awayDir).normalize()
  if (portDir.lengthSq() < 1e-10 || away.lengthSq() < 1e-10) return null

  const turn = portDir.angleTo(away)
  if (turn < MIN_TURN_RAD || turn > MAX_TURN_RAD) return null
  const angleDeg = Math.min(90, (turn * 180) / Math.PI)

  // Rotation mapping the local pair onto the world pair: local +X (the
  // inlet axis, flow direction) → portDir, local outlet → awayDir. Both
  // pairs subtend the same angle, so a shared-plane basis transfer is
  // exact.
  const outletLocal = new Vector3(Math.cos(turn), 0, Math.sin(turn))
  const localFrame = frame(new Vector3(1, 0, 0), outletLocal)
  const worldFrame = frame(portDir, away)
  if (!localFrame || !worldFrame) return null
  const rotation = new Quaternion().setFromRotationMatrix(
    worldFrame.multiply(localFrame.transpose()),
  )
  const euler = new Euler().setFromQuaternion(rotation)

  // Junction sits exactly ON the corner the user drew. The elbow's inlet
  // leg therefore overlaps the last stretch of the existing run — the
  // caller trims that run back to `trimmedPortPoint` so the elbow
  // replaces it and the visual corner stays put.
  const leg = fittingLegLength(diameterIn)
  const junction = new Vector3(...port.position)
  const collar = junction.clone().addScaledVector(away, leg)
  const trimmed = junction.clone().addScaledVector(portDir, -leg)

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
    angle: angleDeg,
    diameter: diameterIn,
    diameter2: diameterIn,
    // Corner elbows are sheet metal even on flex runs (adjustable elbows).
    ductMaterial: 'sheet-metal',
    system,
    position: [junction.x, junction.y, junction.z],
    rotation: [euler.x, euler.y, euler.z],
  })

  return {
    fitting,
    collarPoint: [collar.x, collar.y, collar.z],
    trimmedPortPoint: [trimmed.x, trimmed.y, trimmed.z],
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
  const legRun = fittingLegLength(trunk.diameter)
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
    diameter: trunk.diameter,
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
    diameter: trunk.diameter,
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
