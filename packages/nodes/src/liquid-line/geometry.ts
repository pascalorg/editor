import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { LiquidLineNode } from './schema'

const RADIAL_SEGMENTS = 16
const COPPER_COLOR = '#b06b3f'

const UP = new Vector3(0, 1, 0)

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
 * Pure geometry builder for a standalone liquid line: a single thin bare-copper
 * cylinder following the node path centerline.
 *
 * Each line is a standalone two-point node (no fitting system), so a sphere caps
 * BOTH endpoints. On a free end it rounds the cap; where two segments share a
 * coordinate the coincident spheres fill the miter gap, so the turn reads as
 * continuous pipe.
 *
 * Children are level-local meters; `<ParametricNodeRenderer>` owns the node
 * transform (identity today — the path is absolute within the level).
 */
export function buildLiquidLineGeometry(node: LiquidLineNode): Group {
  const group = new Group()
  if (node.path.length < 2) return group

  const radius = (node.diameter * INCHES_TO_METERS) / 2
  const copperMat = new MeshStandardMaterial({
    color: COPPER_COLOR,
    metalness: 0.8,
    roughness: 0.3,
  })

  const points = node.path.map(([x, y, z]) => new Vector3(x, y, z))

  for (let i = 0; i < points.length - 1; i++) {
    const run = buildRun(points[i]!, points[i + 1]!, radius, copperMat, `liquid-line-${i}`)
    if (run) group.add(run)
  }

  // Spherical caps at every point: interior corners read as continuous pipe,
  // and endpoint caps round the open ends so two separate segments sharing a
  // coordinate fill the miter and look welded.
  for (let i = 0; i < points.length; i++) {
    const joint = new Mesh(new SphereGeometry(radius, RADIAL_SEGMENTS, 10), copperMat)
    joint.name = `liquid-line-joint-${i}`
    joint.position.copy(points[i] as Vector3)
    group.add(joint)
  }

  return group
}
