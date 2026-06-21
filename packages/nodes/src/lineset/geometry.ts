import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { LinesetNode } from './schema'

const RADIAL_SEGMENTS = 16

const COPPER_COLOR = '#b06b3f'
// Light foam sleeve. Real Armaflex is black, but a light jacket reads
// cleaner against the scene and matches the white pipe materials.
const INSULATION_COLOR = '#e8e8ea'

const UP = new Vector3(0, 1, 0)

/**
 * Foam-jacket thickness (meters) wrapped around the line when `insulated`. A
 * real ~3/4" black Armaflex sleeve adds ~3/8" of wall; this matches that so an
 * insulated line reads visibly fatter than the bare copper underneath.
 */
const INSULATION_THICKNESS_M = 0.01

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
 * Pure geometry builder for a refrigerant lineset: a single copper line that
 * follows the node path centerline, optionally wrapped in a foam jacket.
 *
 * One line per node — what the ghost previews is exactly what commits. To run
 * the suction line beside the liquid line, draw them as two separate linesets
 * rather than rendering both together off one path.
 *
 * Each line is a standalone two-point node (no fitting system, unlike ducts),
 * so a sphere caps BOTH endpoints. On a free end it just rounds the cap; where
 * two segments share a coordinate the coincident spheres fill the miter gap, so
 * the turn reads as continuous pipe.
 *
 * Children are level-local meters; `<ParametricNodeRenderer>` owns the
 * node transform (identity today — the path is absolute within the level).
 */
export function buildLinesetGeometry(node: LinesetNode): Group {
  const group = new Group()
  if (node.path.length < 2) return group

  const copperR = (node.suctionDiameter * INCHES_TO_METERS) / 2
  const jacketR = node.insulated ? copperR + INSULATION_THICKNESS_M : copperR

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

  for (let i = 0; i < points.length - 1; i++) {
    const copper = buildRun(points[i]!, points[i + 1]!, copperR, copperMat, `lineset-copper-${i}`)
    if (copper) group.add(copper)
    if (node.insulated) {
      const jacket = buildRun(
        points[i]!,
        points[i + 1]!,
        jacketR,
        insulationMat,
        `lineset-jacket-${i}`,
      )
      if (jacket) group.add(jacket)
    }
  }

  // Spherical caps at every point. Interior corners read as continuous pipe;
  // endpoint caps round the open ends and, where two separate segments share a
  // coordinate, the coincident spheres fill the miter so the turn looks welded.
  for (let i = 0; i < points.length; i++) {
    const joint = new Mesh(new SphereGeometry(copperR, RADIAL_SEGMENTS, 10), copperMat)
    joint.name = `lineset-copper-joint-${i}`
    joint.position.copy(points[i] as Vector3)
    group.add(joint)
    if (node.insulated) {
      const jJoint = new Mesh(new SphereGeometry(jacketR, RADIAL_SEGMENTS, 10), insulationMat)
      jJoint.name = `lineset-jacket-joint-${i}`
      jJoint.position.copy(points[i] as Vector3)
      group.add(jJoint)
    }
  }

  return group
}
