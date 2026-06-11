import { DuctFittingNode } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { fittingLegLength } from '../duct-fitting/ports'
import type { ScenePort } from './ports'

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
