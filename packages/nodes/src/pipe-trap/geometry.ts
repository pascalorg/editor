import { DoubleSide, Group, Mesh, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import { buildSection, INCHES_TO_METERS } from '../duct-segment/geometry'
import { createPipeMaterial } from '../pipe-segment/geometry'
import type { PipeTrapNode } from './schema'

const BEND_SEGMENTS = 24
const RADIAL_SEGMENTS = 20
/** Sphere hubs filling the U-bend → stub joints read as a coupling and,
 *  more importantly, hide the wedge gap left where the horizontal arm's
 *  flat end cap meets the bend's upward-facing opening at 90°. */
const HUB_RADIUS_FACTOR = 1.12

/** Inlet drop and arm reach in pipe radii — keeps the trap proportional
 *  to its size without per-size tuning. */
const INLET_DROP_RADII = 2.6
const ARM_REACH_RADII = 3.2

/**
 * P-trap geometry in the LOCAL frame (origin at the trap weir, the low
 * point of the U). Inlet stub rises +Y to the fixture tailpiece; a
 * half-torus U-bend turns the flow; the trap arm runs +X toward the
 * vented waste line. `<ParametricNodeRenderer>` applies position + yaw.
 */
export function buildPipeTrapGeometry(node: PipeTrapNode): Group {
  const group = new Group()
  const material = createPipeMaterial({ pipeMaterial: node.pipeMaterial, system: 'waste' })
  // Double-sided so the thin pipe walls don't drop out at grazing angles,
  // which read as cuts/holes on the bend and stub ends.
  material.side = DoubleSide
  const radius = (node.diameter * INCHES_TO_METERS) / 2
  const bendR = radius * 1.6
  const hubRadius = radius * HUB_RADIUS_FACTOR

  // U-bend: half torus in the XY plane, opening upward. Sits so its two
  // tops are at y = bendR (the inlet riser and the arm rise).
  const bend = new Mesh(new TorusGeometry(bendR, radius, 12, BEND_SEGMENTS, Math.PI), material)
  bend.rotation.z = Math.PI // open side up
  bend.position.set(bendR, bendR, 0)
  bend.name = 'pipe-trap-bend'
  group.add(bend)

  // Inlet riser: from the left top of the U straight up to the fixture.
  const inletDrop = radius * INLET_DROP_RADII
  const inletTop = new Vector3(0, bendR + inletDrop, 0)
  const inletStub = buildSection(
    new Vector3(0, bendR, 0),
    inletTop,
    radius,
    material,
    'pipe-trap-inlet',
  )
  if (inletStub) group.add(inletStub)

  // Trap arm: from the right top of the U horizontally along +X.
  const armReach = Math.max(radius * ARM_REACH_RADII, node.armLengthM)
  const armStart = new Vector3(bendR * 2, bendR, 0)
  const armEnd = new Vector3(bendR * 2 + armReach, bendR, 0)
  const arm = buildSection(armStart, armEnd, radius, material, 'pipe-trap-arm')
  if (arm) group.add(arm)

  // Coupling hubs at the two U-bend tops where the straight stubs meet the
  // torus. They fill the 90° miter wedge (the visible "cut") and read as
  // the trap's slip-joint nuts.
  for (const [i, center] of [
    new Vector3(0, bendR, 0),
    new Vector3(bendR * 2, bendR, 0),
  ].entries()) {
    const hub = new Mesh(new SphereGeometry(hubRadius, RADIAL_SEGMENTS, 12), material)
    hub.name = `pipe-trap-hub-${i}`
    hub.position.copy(center)
    group.add(hub)
  }

  return group
}

/** Local-frame port positions (before position/yaw): inlet at the top
 *  of the riser facing +Y, outlet at the end of the arm facing +X. */
export function localTrapPorts(node: PipeTrapNode): {
  inlet: Vector3
  outlet: Vector3
} {
  const radius = (node.diameter * INCHES_TO_METERS) / 2
  const bendR = radius * 1.6
  const inletDrop = radius * INLET_DROP_RADII
  const armReach = Math.max(radius * ARM_REACH_RADII, node.armLengthM)
  return {
    inlet: new Vector3(0, bendR + inletDrop, 0),
    outlet: new Vector3(bendR * 2 + armReach, bendR, 0),
  }
}
