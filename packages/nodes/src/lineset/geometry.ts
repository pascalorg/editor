import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { LinesetNode } from './schema'

const RADIAL_SEGMENTS = 16

const COPPER_COLOR = '#b06b3f'
// Light foam sleeve. Real Armaflex is black, but a light jacket reads
// cleaner against the scene and matches the white pipe materials.
const INSULATION_COLOR = '#e8e8ea'

const UP = new Vector3(0, 1, 0)
const FALLBACK_PERP = new Vector3(1, 0, 0)

/**
 * Foam-jacket thickness (meters) wrapped around the suction line when
 * `insulated`. A real ~3/4" black Armaflex sleeve adds ~3/8" of wall; this
 * matches that so the insulated suction line reads visibly fatter than the
 * bare liquid line beside it.
 */
const INSULATION_THICKNESS_M = 0.01

/** Cap on the miter-length multiplier so a sharp turn doesn't shoot the
 * corner off to infinity — past this we'd want a bevel, but linesets bend
 * gently enough that clamping is invisible. */
const MITER_LIMIT = 4

/**
 * Horizontal side vector for each path segment — the axis the two lines are
 * pushed apart along, kept HORIZONTAL so the pair never tilts. A vertical
 * (riser) segment has no horizontal heading of its own, so it inherits the
 * side vector from the nearest segment that does; this is what keeps the two
 * lines side by side as the run climbs instead of rotating about the bend.
 * Falls back to the X axis only if the whole path is vertical.
 */
function segmentSides(points: Vector3[]): Vector3[] {
  const sides: (Vector3 | null)[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const dir = new Vector3().subVectors(points[i + 1]!, points[i]!)
    const horizontal = new Vector3(dir.x, 0, dir.z)
    sides.push(horizontal.lengthSq() < 1e-9 ? null : horizontal.normalize().cross(UP).normalize())
  }
  // Forward then backward fill so vertical segments adopt a real heading.
  for (let i = 1; i < sides.length; i++) if (!sides[i]) sides[i] = sides[i - 1] ?? null
  for (let i = sides.length - 2; i >= 0; i--) if (!sides[i]) sides[i] = sides[i + 1] ?? null
  return sides.map((s) => s ?? FALLBACK_PERP.clone())
}

/**
 * Per-vertex offset vectors for turning the path into two parallel lines.
 * At an interior vertex the offset follows the angle bisector of the two
 * adjacent segment side vectors, scaled by `1/cos(half-angle)` so the offset
 * segments on either side of the bend meet exactly at one miter point (a
 * plain per-segment side leaves them crossing/gapping). Endpoints use their
 * single segment's side. Side vectors are horizontal, so the offset is too —
 * a horizontal→vertical bend keeps the same side (cos 1, no expansion),
 * leaving the pair perfectly side by side up the riser. The returned vector
 * is the `+offset` (liquid) side; the suction side is its negation.
 */
function miterOffsets(points: Vector3[], offset: number): Vector3[] {
  const sides = segmentSides(points)
  return points.map((_p, i) => {
    const sIn = i > 0 ? sides[i - 1]! : null
    const sOut = i < sides.length ? sides[i]! : null
    if (sIn && sOut) {
      const bisector = sIn.clone().add(sOut)
      // s_in == -s_out → a 180° switchback; the bisector vanishes, so just
      // run straight out on one side.
      if (bisector.lengthSq() < 1e-9) return sIn.clone().multiplyScalar(offset)
      bisector.normalize()
      const cos = bisector.dot(sIn)
      const scale = Math.min(MITER_LIMIT, 1 / Math.max(cos, 1 / MITER_LIMIT))
      return bisector.multiplyScalar(offset * scale)
    }
    return (sIn ?? sOut)!.clone().multiplyScalar(offset)
  })
}

/** Cylinder spanning `start`→`end` at `radius`, named for debugging. */
function buildRun(
  start: Vector3,
  end: Vector3,
  radius: number,
  material: MeshStandardMaterial,
  name: string,
): Mesh | null {
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-6) return null
  dir.normalize()
  const mesh = new Mesh(
    new CylinderGeometry(radius, radius, length, RADIAL_SEGMENTS, 1, false),
    material,
  )
  mesh.name = name
  mesh.position.copy(start).addScaledVector(dir, length / 2)
  mesh.quaternion.setFromUnitVectors(UP, dir)
  return mesh
}

/**
 * Pure geometry builder for a refrigerant lineset: a fat insulated suction
 * line beside a thin bare-copper liquid line, both following the node path.
 *
 * The two lines are offset symmetrically about the path centerline along a
 * horizontal perpendicular to each segment, so the pair reads as a parallel
 * run. Joint spheres cap interior corners on each line; the suction line's
 * light foam jacket is a larger opaque cylinder over the copper.
 *
 * Children are level-local meters; `<ParametricNodeRenderer>` owns the
 * node transform (identity today — the path is absolute within the level).
 */
export function buildLinesetGeometry(node: LinesetNode): Group {
  const group = new Group()
  if (node.path.length < 2) return group

  const suctionR = (node.suctionDiameter * INCHES_TO_METERS) / 2
  const liquidR = (node.liquidDiameter * INCHES_TO_METERS) / 2
  const jacketR = node.insulated ? suctionR + INSULATION_THICKNESS_M : suctionR
  // Half the center-to-center spacing: the two jackets sit just touching.
  const offset = jacketR + liquidR

  const copperMat = new MeshStandardMaterial({
    color: COPPER_COLOR,
    metalness: 0.8,
    roughness: 0.3,
  })
  const insulationMat = new MeshStandardMaterial({
    color: INSULATION_COLOR,
    metalness: 0.1,
    roughness: 0.9,
  })

  const points = node.path.map(([x, y, z]) => new Vector3(x, y, z))

  // Miter-offset each path point so the two parallel lines meet cleanly at
  // every bend instead of drifting apart (a plain per-segment perpendicular
  // leaves the inner line cutting the corner).
  const offsets = miterOffsets(points, offset)
  const suctionPts = points.map((p, i) => p.clone().sub(offsets[i]!))
  const liquidPts = points.map((p, i) => p.clone().add(offsets[i]!))

  for (let i = 0; i < points.length - 1; i++) {
    const sCopper = buildRun(
      suctionPts[i]!,
      suctionPts[i + 1]!,
      suctionR,
      copperMat,
      `lineset-suction-${i}`,
    )
    if (sCopper) group.add(sCopper)
    const liquid = buildRun(
      liquidPts[i]!,
      liquidPts[i + 1]!,
      liquidR,
      copperMat,
      `lineset-liquid-${i}`,
    )
    if (liquid) group.add(liquid)
    if (node.insulated) {
      const jacket = buildRun(
        suctionPts[i]!,
        suctionPts[i + 1]!,
        jacketR,
        insulationMat,
        `lineset-jacket-${i}`,
      )
      if (jacket) group.add(jacket)
    }
  }

  // Joint caps at interior corners so turns read as continuous pipe.
  for (let i = 1; i < points.length - 1; i++) {
    const sJoint = new Mesh(new SphereGeometry(suctionR, RADIAL_SEGMENTS, 10), copperMat)
    sJoint.name = `lineset-suction-joint-${i}`
    sJoint.position.copy(suctionPts[i] as Vector3)
    group.add(sJoint)
    const lJoint = new Mesh(new SphereGeometry(liquidR, RADIAL_SEGMENTS, 10), copperMat)
    lJoint.name = `lineset-liquid-joint-${i}`
    lJoint.position.copy(liquidPts[i] as Vector3)
    group.add(lJoint)
    if (node.insulated) {
      const jJoint = new Mesh(new SphereGeometry(jacketR, RADIAL_SEGMENTS, 10), insulationMat)
      jJoint.name = `lineset-jacket-joint-${i}`
      jJoint.position.copy(suctionPts[i] as Vector3)
      group.add(jJoint)
    }
  }

  return group
}
