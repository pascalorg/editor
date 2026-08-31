import { type AssetInput, isObject } from '@pascal-app/core'
import { Euler, Matrix3, type Matrix4, Quaternion, Vector3 } from 'three'
import { resolveSnapFlags } from '../../../lib/snapping-mode'
import useEditor, { getActiveSnappingMode } from '../../../store/use-editor'

// Sentinel returned when the active context's snapping mode disables grid snap.
// The snap helpers below treat any `step <= 0` as "no grid snap" and pass the
// raw value through. For items the default mode is now `lines` (grid off), so
// item placement/move is free + line-snap unless the user opts into `grid`.
function getGridSnapStep(): number {
  return resolveSnapFlags(getActiveSnappingMode()).grid ? useEditor.getState().gridSnapStep : 0
}

const ROTATION_QUANTUM = Math.PI / 4

/**
 * R/T rotation: round the current angle to the nearest 45° then step ONE
 * increment in `direction` (+1 / -1), so the node always lands on a clean 45°
 * multiple regardless of its starting angle (12° → 45°, 40° → 90°) rather than a
 * blind ±45° from an arbitrary angle.
 */
export function steppedRotation(current: number, direction: 1 | -1): number {
  return (Math.round(current / ROTATION_QUANTUM) + direction) * ROTATION_QUANTUM
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

/**
 * Snaps a position to the active grid step, aligning item edges to grid lines.
 */
export function snapToGrid(position: number, dimension: number, step = getGridSnapStep()): number {
  if (step <= 0) return position
  const halfDim = dimension / 2
  const offset = positiveModulo(halfDim, step)
  return Math.round((position - offset) / step) * step + offset
}

/**
 * Snap a value to the active grid step (used for wall-local positions).
 */
export function snapToHalf(value: number, step = getGridSnapStep()): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/**
 * Round a value up to the next multiple of `step`, with a minimum of `step`.
 */
export function snapUpToGridStep(value: number, step = getGridSnapStep()): number {
  if (step <= 0) return value
  return Math.max(step, Math.ceil(value / step) * step)
}

/**
 * Expand an item's scaled dimensions up to the active grid step on the axes
 * the placement grid covers. Used for the placement wireframe, snap math, and
 * collision against the draft so a small item visually reserves a full grid
 * cell.
 *
 * - Floor / ceiling / item-surface: X + Z (footprint) expand; Y stays exact.
 * - Wall / wall-side: X (along wall) + Y (height) expand; Z (depth) stays exact
 *   so wall-thickness offsets aren't disturbed.
 */
export function getGridAlignedDimensions(
  scaledDims: [number, number, number],
  attachTo: AssetInput['attachTo'] | null | undefined,
  step = getGridSnapStep(),
): [number, number, number] {
  const [w, h, d] = scaledDims
  if (attachTo === 'wall' || attachTo === 'wall-side') {
    return [snapUpToGridStep(w, step), snapUpToGridStep(h, step), d]
  }
  return [snapUpToGridStep(w, step), h, snapUpToGridStep(d, step)]
}

export function getDetachedAttachmentPreviewLift(
  attachTo: AssetInput['attachTo'] | null | undefined,
): number {
  return attachTo ? 0.45 : 0
}

/**
 * Calculate cursor rotation in WORLD space from wall normal and orientation.
 */
export function calculateCursorRotation(
  normal: [number, number, number] | undefined,
  wallStart: [number, number],
  wallEnd: [number, number],
): number {
  if (!normal) return 0

  // Wall direction angle in world XZ plane
  const wallAngle = Math.atan2(wallEnd[1] - wallStart[1], wallEnd[0] - wallStart[0])

  // In local wall space, front face has normal.z < 0, back face has normal.z > 0
  if (normal[2] < 0) {
    return -wallAngle
  }
  return Math.PI - wallAngle
}

/**
 * Calculate item rotation in WALL-LOCAL space from normal.
 * Items are children of the wall mesh, so their rotation is relative to wall's local space.
 */
export function calculateItemRotation(normal: [number, number, number] | undefined): number {
  if (!normal) return 0

  return normal[2] > 0 ? 0 : Math.PI
}

/**
 * Determine which side of the wall based on the normal vector.
 * In wall-local space, the wall runs along X-axis, so the normal points along Z-axis.
 * Positive Z normal = 'front', Negative Z normal = 'back'
 */
export function getSideFromNormal(normal: [number, number, number] | undefined): 'front' | 'back' {
  if (!normal) return 'front'
  return normal[2] >= 0 ? 'front' : 'back'
}

/**
 * Check if the normal indicates a valid wall side face (front or back).
 * Filters out top face and thickness edges.
 *
 * In wall-local geometry space (after ExtrudeGeometry + rotateX):
 * - X axis: along wall direction
 * - Y axis: up (height)
 * - Z axis: perpendicular to wall (thickness direction)
 *
 * So valid side faces have normals pointing in ±Z direction (local space).
 */
export function isValidWallSideFace(normal: [number, number, number] | undefined): boolean {
  if (!normal) return false
  return Math.abs(normal[2]) > 0.7
}

/** Strip placement-only metadata flags before committing a draft. */
export function stripTransient(meta: any): any {
  if (!isObject(meta)) return meta
  const nextMeta = { ...(meta as Record<string, any>) }
  delete nextMeta.isNew
  delete nextMeta.isTransient
  return nextMeta
}

const _up = new Vector3(0, 1, 0)
const _normal = new Vector3()
const _quat = new Quaternion()
const _euler = new Euler()

/**
 * Compute euler rotation that tilts an item so its local +Y aligns with a
 * roof surface normal. The normal is in the hit mesh's local space and is
 * transformed to world space via the mesh's matrixWorld.
 */
export function calculateRoofRotation(
  normal: [number, number, number] | undefined,
  objectMatrixWorld: Matrix4,
): [number, number, number] {
  if (!normal) return [0, 0, 0]

  _normal.set(normal[0], normal[1], normal[2])
  _normal.applyNormalMatrix(new Matrix3().getNormalMatrix(objectMatrixWorld)).normalize()

  _quat.setFromUnitVectors(_up, _normal)
  _euler.setFromQuaternion(_quat, 'XYZ')

  return [_euler.x, _euler.y, _euler.z]
}
