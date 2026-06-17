import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import { createOvalSectionGeometry, INCHES_TO_METERS } from '../duct-segment/geometry'
import { COLLAR_LENGTH, mountQuaternion, terminalSystem } from './ports'
import type { DuctTerminalNode } from './schema'

const RADIAL_SEGMENTS = 20

/** Radial clearance (meters) the collar sleeve carries over the duct's
 *  nominal cross-section, so a run leaving at the advertised size nests
 *  inside the sleeve instead of z-fighting its faces. ~5 mm ≈ a slip joint. */
const COLLAR_CLEARANCE_M = 0.005

const FRAME_COLOR = '#e3e5e8'
const SLAT_SUPPLY_COLOR = '#cdd1d6'
const SLAT_RETURN_COLOR = '#aeb4bb'
const COLLAR_COLOR = '#c2c2c2'

/**
 * Pure geometry builder for a duct terminal, in the node's LOCAL frame —
 * `<ParametricNodeRenderer>` applies `position` + yaw, and the builder
 * applies the mount orientation itself.
 *
 * Canonical (floor) frame before the mount rotation: face plate lying
 * in XZ at y=0 with its normal +Y, louver slats just above it, collar
 * cylinder going -Y toward the duct side. Ceiling mounts flip it; wall
 * mounts stand it up facing +Z.
 */
export function buildDuctTerminalGeometry(node: DuctTerminalNode): Group {
  const group = new Group()
  const oriented = new Group()
  oriented.quaternion.copy(mountQuaternion(node.mount))
  group.add(oriented)

  const frameMaterial = new MeshStandardMaterial({
    color: FRAME_COLOR,
    metalness: 0.4,
    roughness: 0.5,
  })
  const slatMaterial = new MeshStandardMaterial({
    color: terminalSystem(node) === 'return' ? SLAT_RETURN_COLOR : SLAT_SUPPLY_COLOR,
    metalness: 0.45,
    roughness: 0.55,
  })

  const frameThickness = 0.018
  const frame = new Mesh(new BoxGeometry(node.width, frameThickness, node.depth), frameMaterial)
  frame.name = 'terminal-frame'
  frame.position.set(0, frameThickness / 2, 0)
  oriented.add(frame)

  // Louver slats across the face. Return grilles read denser; diffusers
  // get concentric-ish wide slats via the same simple pattern.
  const slatCount = node.terminalType === 'return-grille' ? 7 : 4
  const innerDepth = node.depth * 0.82
  const slatDepth = (innerDepth / slatCount) * 0.55
  for (let i = 0; i < slatCount; i++) {
    const slat = new Mesh(new BoxGeometry(node.width * 0.86, 0.006, slatDepth), slatMaterial)
    slat.name = `terminal-slat-${i}`
    const z = -innerDepth / 2 + (innerDepth / slatCount) * (i + 0.5)
    slat.position.set(0, frameThickness + 0.002, z)
    slat.rotation.x = node.terminalType === 'diffuser' ? 0 : -0.5
    oriented.add(slat)
  }

  // Collar runs along -Y from the face toward the duct. Round is a
  // cylinder; rect a box; oval the flat-oval prism (its extrude basis
  // already puts the run length on Y, matching the collar axis). The
  // sleeve is grown one clearance on every side so a duct run leaving at
  // the advertised size nests inside it instead of z-fighting its faces.
  const grow = 2 * COLLAR_CLEARANCE_M
  let collarGeom: BufferGeometry
  if (node.collarShape === 'rect') {
    collarGeom = new BoxGeometry(
      node.collarWidth * INCHES_TO_METERS + grow,
      COLLAR_LENGTH,
      node.collarHeight * INCHES_TO_METERS + grow,
    )
  } else if (node.collarShape === 'oval') {
    collarGeom = createOvalSectionGeometry(
      node.collarWidth * INCHES_TO_METERS + grow,
      node.collarHeight * INCHES_TO_METERS + grow,
      COLLAR_LENGTH,
    )
  } else {
    const radius = (node.collarDiameter * INCHES_TO_METERS + grow) / 2
    collarGeom = new CylinderGeometry(radius, radius, COLLAR_LENGTH, RADIAL_SEGMENTS, 1, false)
  }
  const collar = new Mesh(
    collarGeom,
    new MeshStandardMaterial({ color: COLLAR_COLOR, metalness: 0.6, roughness: 0.4 }),
  )
  collar.name = 'terminal-collar'
  collar.position.copy(new Vector3(0, -COLLAR_LENGTH / 2, 0))
  oriented.add(collar)

  return group
}
