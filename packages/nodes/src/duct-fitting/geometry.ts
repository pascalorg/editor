import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
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
  } else {
    const isRect = node.shape === 'rect'
    const widthM = node.width * INCHES_TO_METERS
    const heightM = node.height * INCHES_TO_METERS
    // Run legs (elbow inlet/outlet, tee inlet/outlet) follow the shape;
    // a tee's branch collar is always round.
    const isRunLeg = (id: string) => id === 'inlet' || id === 'outlet'
    for (const port of ports) {
      const stub =
        isRect && isRunLeg(port.id)
          ? buildRectSection(
              new Vector3(0, 0, 0),
              port.position,
              widthM,
              heightM,
              material,
              `fitting-stub-${port.id}`,
            )
          : buildSection(
              new Vector3(0, 0, 0),
              port.position,
              (port.diameter * INCHES_TO_METERS) / 2,
              material,
              `fitting-stub-${port.id}`,
            )
      if (stub) group.add(stub)
    }
    const junction = isRect
      ? new Mesh(new BoxGeometry(widthM * 1.02, heightM * 1.02, widthM * 1.02), material)
      : new Mesh(new SphereGeometry(radiusMain * 1.02, RADIAL_SEGMENTS, 12), material)
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
