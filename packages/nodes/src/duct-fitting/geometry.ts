import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  type MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import {
  buildRectSection,
  buildSection,
  createDuctMaterial,
  INCHES_TO_METERS,
} from '../duct-segment/geometry'
import { localFittingPorts } from './ports'
import type { DuctFittingNode } from './schema'

const RADIAL_SEGMENTS = 24
const UP = new Vector3(0, 1, 0)

/**
 * Mitered rectangular elbow as ONE closed solid — the way sheet-metal
 * square elbows are actually folded. The rect profile sweeps from the
 * inlet face to the outlet face through a single miter ring lying on
 * the corner's bisector plane (the classic 2D miter-join offset:
 * join(u) = (wA + wB) · u / (1 + wA·wB)), so the two legs meet in a
 * crisp seam instead of interpenetrating boxes.
 *
 * Local frame: legs in the XZ plane (ports convention), profile height
 * along local Y. Non-indexed triangles → flat face normals for the
 * folded-metal look; the closed solid renders double-sided so winding
 * never makes a face vanish.
 */
function buildMiteredRectElbow(
  inletPos: Vector3,
  outletPos: Vector3,
  widthM: number,
  heightM: number,
  material: MeshStandardMaterial,
): Mesh {
  const travelIn = inletPos.clone().multiplyScalar(-1).normalize() // inlet → junction
  const travelOut = outletPos.clone().normalize() // junction → outlet
  const wA = new Vector3().crossVectors(UP, travelIn).normalize()
  const wB = new Vector3().crossVectors(UP, travelOut).normalize()
  // Elbow turns are ≤ 90°, so wA·wB ≥ 0 and the join never degenerates.
  const miterScale = 1 / (1 + wA.dot(wB))
  const wJoin = new Vector3().addVectors(wA, wB)

  const hw = widthM / 2
  const hh = heightM / 2
  const corners: Array<[number, number]> = [
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ]
  const ring = (center: Vector3, uAxis: Vector3, scale = 1): Vector3[] =>
    corners.map(([u, v]) =>
      center
        .clone()
        .addScaledVector(uAxis, u * scale)
        .addScaledVector(UP, v),
    )

  const inletRing = ring(inletPos, wA)
  const miterRing = ring(new Vector3(0, 0, 0), wJoin, miterScale)
  const outletRing = ring(outletPos, wB)

  const positions: number[] = []
  const tri = (a: Vector3, b: Vector3, c: Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
    tri(a, b, c)
    tri(a, c, d)
  }
  const skin = (from: Vector3[], to: Vector3[]) => {
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4
      quad(from[k]!, to[k]!, to[k2]!, from[k2]!)
    }
  }
  skin(inletRing, miterRing)
  skin(miterRing, outletRing)
  // End caps.
  quad(inletRing[0]!, inletRing[1]!, inletRing[2]!, inletRing[3]!)
  quad(outletRing[3]!, outletRing[2]!, outletRing[1]!, outletRing[0]!)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const solidMaterial = material.clone()
  solidMaterial.side = DoubleSide
  const mesh = new Mesh(geometry, solidMaterial)
  mesh.name = 'fitting-elbow-rect'
  return mesh
}

/**
 * Pure geometry builder for a duct fitting, in the fitting's LOCAL frame —
 * `<ParametricNodeRenderer>` applies `node.position` / `node.rotation`.
 *
 * Strategy: one cylinder stub per port from the junction center outward
 * (reusing the segment builder's `buildSection`), a sphere at the
 * junction, and a slightly-oversized crimp collar ring at each port
 * opening so fittings read as sheet-metal junctions rather than bare
 * tube ends.
 *
 * The reducer is special-cased: instead of equal stubs + sphere it draws
 * a short inlet stub, a tapered cone, and a short outlet stub inline.
 *
 * `shape: 'rect'` (elbow / tee): run legs become boxes at the fitting's
 * width × height (matching the rect trunk they join) with a cube
 * junction; a tee's branch leg stays a round cylinder at `diameter2`.
 * The rect profile's height rides local +Y — for the horizontal-plane
 * orientations rect trunks are drawn in, that's world-vertical.
 */
export function buildDuctFittingGeometry(node: DuctFittingNode): Group {
  const group = new Group()
  const material = createDuctMaterial(node)
  const radiusMain = (node.diameter * INCHES_TO_METERS) / 2
  const ports = localFittingPorts(node)

  if (node.fittingType === 'reducer') {
    const radiusOut = (node.diameter2 * INCHES_TO_METERS) / 2
    const inlet = ports[0]!
    const outlet = ports[1]!
    const taperHalf = Math.abs(inlet.position.x) / 3
    const stubA = buildSection(
      inlet.position,
      new Vector3(-taperHalf, 0, 0),
      radiusMain,
      material,
      'fitting-stub-inlet',
    )
    if (stubA) group.add(stubA)
    const cone = new Mesh(
      new CylinderGeometry(radiusOut, radiusMain, taperHalf * 2, RADIAL_SEGMENTS, 1, false),
      material,
    )
    cone.name = 'fitting-taper'
    cone.quaternion.setFromUnitVectors(UP, new Vector3(1, 0, 0))
    group.add(cone)
    const stubB = buildSection(
      new Vector3(taperHalf, 0, 0),
      outlet.position,
      radiusOut,
      material,
      'fitting-stub-outlet',
    )
    if (stubB) group.add(stubB)
  } else if (node.shape === 'rect' && node.fittingType === 'elbow') {
    // One mitered solid — no stubs, no junction blob.
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    group.add(
      buildMiteredRectElbow(
        inlet.position,
        outlet.position,
        node.width * INCHES_TO_METERS,
        node.height * INCHES_TO_METERS,
        material,
      ),
    )
  } else if (node.shape === 'rect' && node.fittingType === 'tee') {
    // Straight rect run inlet→outlet (one box — nothing to miter) with a
    // round branch stub tapping its side.
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    const branch = ports.find((p) => p.id === 'branch')!
    const run = buildRectSection(
      inlet.position,
      outlet.position,
      node.width * INCHES_TO_METERS,
      node.height * INCHES_TO_METERS,
      material,
      'fitting-run',
    )
    if (run) group.add(run)
    const stub = buildSection(
      new Vector3(0, 0, 0),
      branch.position,
      (branch.diameter * INCHES_TO_METERS) / 2,
      material,
      'fitting-stub-branch',
    )
    if (stub) group.add(stub)
  } else {
    for (const port of ports) {
      const stub = buildSection(
        new Vector3(0, 0, 0),
        port.position,
        (port.diameter * INCHES_TO_METERS) / 2,
        material,
        `fitting-stub-${port.id}`,
      )
      if (stub) group.add(stub)
    }
    const junction = new Mesh(new SphereGeometry(radiusMain * 1.02, RADIAL_SEGMENTS, 12), material)
    junction.name = 'fitting-junction'
    group.add(junction)
  }

  // Crimp collar at each opening — a thin torus just proud of the stub.
  // Round collars only; rect run legs end in the bare box profile.
  for (const port of ports) {
    if (node.shape === 'rect' && (port.id === 'inlet' || port.id === 'outlet')) continue
    const radius = (port.diameter * INCHES_TO_METERS) / 2
    const collar = new Mesh(new TorusGeometry(radius, radius * 0.12, 8, RADIAL_SEGMENTS), material)
    collar.name = `fitting-collar-${port.id}`
    collar.position.copy(port.position)
    collar.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), port.direction)
    group.add(collar)
  }

  return group
}
