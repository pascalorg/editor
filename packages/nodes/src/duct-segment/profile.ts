import { Vector3 } from 'three'

export const INCHES_TO_METERS = 0.0254
const UP = new Vector3(0, 1, 0)

/**
 * Area-equivalent round diameter (inches) for a rect cross-section —
 * what a rect trunk advertises on its ports so round fittings / branches
 * mate at a sensible size.
 */
export function equivalentDiameterIn(widthIn: number, heightIn: number): number {
  return 2 * Math.sqrt((widthIn * heightIn) / Math.PI)
}

/**
 * Area-equivalent round diameter (inches) for a flat-oval cross-section:
 * a rectangle of (width − height) × height plus the two semicircular caps.
 */
export function ovalEquivalentDiameterIn(widthIn: number, heightIn: number): number {
  const minor = Math.min(widthIn, heightIn)
  const major = Math.max(widthIn, heightIn)
  const area = (major - minor) * minor + Math.PI * (minor / 2) ** 2
  return 2 * Math.sqrt(area / Math.PI)
}

/** The diameter (inches) a duct segment presents at its ports. */
export function ductPortDiameterIn(node: {
  shape?: 'round' | 'rect' | 'oval'
  diameter: number
  width?: number
  height?: number
}): number {
  if (node.shape === 'rect' && node.width && node.height) {
    return equivalentDiameterIn(node.width, node.height)
  }
  if (node.shape === 'oval' && node.width && node.height) {
    return ovalEquivalentDiameterIn(node.width, node.height)
  }
  return node.diameter
}

/**
 * Cross-section axes for a rect run along `dir`, rolled `roll` radians
 * about the run direction. At roll 0: width is the horizontal axis
 * (UP × dir) and height the vertical one — vertical runs, where that
 * cross product degenerates, fall back to world X/Z. `roll` rotates the
 * pair in the plane perpendicular to `dir`, letting a riser carry the
 * orientation of the run it turned off instead of the bare fallback.
 */
export function rectSectionAxes(dir: Vector3, roll = 0): { width: Vector3; height: Vector3 } {
  const d = dir.clone().normalize()
  const xBase = new Vector3().crossVectors(UP, d)
  if (xBase.lengthSq() < 1e-8) xBase.set(1, 0, 0)
  xBase.normalize()
  const zBase = new Vector3().crossVectors(xBase, d)
  const c = Math.cos(roll)
  const s = Math.sin(roll)
  const width = xBase.clone().multiplyScalar(c).addScaledVector(zBase, s)
  const height = xBase.clone().multiplyScalar(-s).addScaledVector(zBase, c)
  return { width, height }
}

/**
 * Roll (radians) that keeps a rect cross-section continuous across an
 * elbow: the dimension lying along the joint's hinge — the bend-plane
 * normal `portDir × newDir`, perpendicular to both legs — must stay on
 * the same physical face on the new run as on the source run. Returns 0
 * for an in-plane (degenerate-normal) joint, so horizontal turns keep
 * the natural width-horizontal orientation.
 */
export function rollToContinueAcrossElbow(
  sourceDir: Vector3,
  sourceRoll: number,
  portDir: Vector3,
  newDir: Vector3,
): number {
  const n = new Vector3().crossVectors(portDir, newDir)
  if (n.lengthSq() < 1e-8) return 0
  n.normalize()
  const src = rectSectionAxes(sourceDir, sourceRoll)
  const carriesWidth = Math.abs(src.width.dot(n)) >= Math.abs(src.height.dot(n))
  const d = newDir.clone().normalize()
  const xBase = new Vector3().crossVectors(UP, d)
  if (xBase.lengthSq() < 1e-8) xBase.set(1, 0, 0)
  xBase.normalize()
  const zBase = new Vector3().crossVectors(xBase, d)
  // Place the hinge-aligned face on the same axis the source carries it.
  return carriesWidth
    ? Math.atan2(n.dot(zBase), n.dot(xBase))
    : Math.atan2(-n.dot(xBase), n.dot(zBase))
}
