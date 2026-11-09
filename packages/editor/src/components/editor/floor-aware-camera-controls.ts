import { CameraControlsImpl } from '@react-three/drei'
import { Vector3 } from 'three'
import {
  floorLimitAt,
  glideFloorLimit,
  ORBIT_FLOOR_CLEARANCE,
  orbitCameraAboveFloor,
} from '../../lib/orbit-floor-clearance'

const virtualTarget = new Vector3()
const virtualPosition = new Vector3()
const groundedPosition = new Vector3()
const drawnTarget = new Vector3()
const shiftDelta = new Vector3()
// Below this height over the level's floor limit the surface under the camera
// is looked up; higher up it cannot matter.
const SURFACE_BAND = 3
// While the limit glides up over a platform's edge, the camera still never
// sits closer than this to the floor it is over.
const SURFACE_MIN_GAP = 0.05

/** The walkable surface under the camera (see `FloorSurface`). */
export type CameraFloorSurface = {
  /** Changes whenever an earlier answer may no longer hold. */
  readonly revision: number
  topAt(x: number, z: number, levelY: number): number | null
}

/**
 * Orbit controls whose own state never puts a perspective camera under the
 * floor surface below it: an orbit past the clearance keeps the camera on it
 * and pitches the view up (walls do not stop it: it passes through them). The
 * push and pitch are applied to the controls' own target and angle, so every
 * reader (`getPosition`, `getTarget`, `camera.position`, truck speed,
 * snapshots) sees the pose that is drawn. `floorShift` is the
 * push currently applied; the orbit underneath it is what a later rotate or
 * zoom continues from, which is why orbiting back up returns the exact
 * earlier pose.
 */
export class FloorAwareCameraControls extends CameraControlsImpl {
  /**
   * The active level's floor plus the clearance: the limit where no floor
   * surface is found under the camera. Null turns the floor off.
   */
  floorMinY: number | null = null
  /** Walkable surface of the active level; the limit follows its top. */
  floorSurface: CameraFloorSurface | null = null
  // The floor limit under the camera, eased as the camera crosses floors of
  // different heights; the last floor found on this level, kept over holes
  // (a stair void) and through a slab's rebuild; and the last lookup, reused
  // at rest.
  private surfaceMinY: number | null = null
  private surfaceTop: number | null = null
  private surfaceLevelY: number | null = null
  private surfaceQuery = { x: Number.NaN, z: Number.NaN, revision: -1, top: null as number | null }
  private frame = 0
  private frameDelta = 0
  private glideFrame = -1
  private readonly floorShift = new Vector3()
  // How much steeper the drawn view is than the orbit (the look-up pitch).
  private polarShift = 0
  // A pose written with `setLookAt` (applied pose, saved view, snapshot
  // replay) is shown exactly, even under the clearance; the floor holds at
  // its height until the orbit heads back above the clearance or the floor
  // itself changes (another level).
  private heldMinY: number | null = null
  private heldFloorMinY: number | null = null
  private relativeMove = false
  private relativeRotate = false
  private readonly floorUpdateEvent = { type: 'update' }
  /** The lowest the camera may sit right now: the clearance above the floor under it. */
  get floorLimitY() {
    return this.surfaceMinY ?? this.floorMinY
  }

  // Level navigation translates the orbit's floor, rather than its pushed target.
  getOrbitTarget(out: Vector3) {
    return this.getTarget(out).sub(this.floorShift)
  }

  /** The orbit's own polar angle, under the floor's look-up pitch. */
  get orbitPolarAngle() {
    return this._spherical.phi - this.polarShift
  }

  // Back to the orbit under the floor's push and pitch. Nothing is drawn in
  // between: the next update re-derives the same drawn pose from it.
  private dropFloorShift() {
    this._target.sub(this.floorShift)
    this._targetEnd.sub(this.floorShift)
    this._spherical.phi -= this.polarShift
    this._sphericalEnd.phi -= this.polarShift
    this.floorShift.set(0, 0, 0)
    this.polarShift = 0
  }

  override moveTo(x: number, y: number, z: number, enableTransition = false) {
    // Absolute destinations replace the orbit; trucks keep its remembered push.
    if (!this.relativeMove) {
      // Travel from the orbit under the push, not from the pushed target: the
      // push is recomputed on the way, so nothing jumps, and a low camera
      // does not start the trip lifted above its orbit.
      this.dropFloorShift()
      this.heldMinY = null
    }
    return super.moveTo(x, y, z, enableTransition)
  }

  override fitToBox(...args: Parameters<CameraControlsImpl['fitToBox']>) {
    // Framing starts from the orbit, not from the floor's look-up pitch.
    this.dropFloorShift()
    return super.fitToBox(...args)
  }

  override rotate(azimuthAngle: number, polarAngle: number, enableTransition = false) {
    this.relativeRotate = true
    try {
      return super.rotate(azimuthAngle, polarAngle, enableTransition)
    } finally {
      this.relativeRotate = false
    }
  }

  override rotateTo(azimuthAngle: number, polarAngle: number, enableTransition = false) {
    // An absolute angle is the orbit's; drags (`rotate`) keep the look-up pitch.
    if (!this.relativeRotate) this.dropFloorShift()
    return super.rotateTo(azimuthAngle, polarAngle, enableTransition)
  }

  override truck(x: number, y: number, enableTransition = false) {
    this.relativeMove = true
    try {
      return super.truck(x, y, enableTransition)
    } finally {
      this.relativeMove = false
    }
  }

  override forward(distance: number, enableTransition = false) {
    this.relativeMove = true
    try {
      return super.forward(distance, enableTransition)
    } finally {
      this.relativeMove = false
    }
  }

  override elevate(height: number, enableTransition = false) {
    this.relativeMove = true
    try {
      return super.elevate(height, enableTransition)
    } finally {
      this.relativeMove = false
    }
  }

  override setLookAt(
    positionX: number,
    positionY: number,
    positionZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    enableTransition = false,
  ) {
    const done = super.setLookAt(
      positionX,
      positionY,
      positionZ,
      targetX,
      targetY,
      targetZ,
      enableTransition,
    )
    this.floorShift.set(0, 0, 0)
    this.polarShift = 0
    this.heldMinY = positionY
    this.heldFloorMinY = this.floorMinY
    return done
  }

  override update(delta: number): boolean {
    // The base constructor runs one update before this class's fields exist.
    if (this.floorShift !== undefined) {
      this.frame += 1
      this.frameDelta = delta
    }
    const updated = super.update(delta)
    // The base constructor runs one update before this class's fields exist.
    if (this.floorShift !== undefined && this.keepAboveFloor() && !updated) {
      super.dispatchEvent(this.floorUpdateEvent)
      return true
    }
    return updated
  }

  override dispatchEvent(event: Parameters<CameraControlsImpl['dispatchEvent']>[0]) {
    // Base update listeners run before update returns; publish the drawn pose.
    if (event.type === 'update' && this.floorShift !== undefined) this.keepAboveFloor()
    super.dispatchEvent(event)
  }

  private keepAboveFloor() {
    const floorMinY = 'isOrthographicCamera' in this._camera ? null : this.floorMinY
    if (floorMinY === null) {
      // Floor off: what is drawn becomes the orbit, so turning it back on
      // never jumps.
      this.floorShift.set(0, 0, 0)
      this.polarShift = 0
      this.heldMinY = null
      this.forgetFloorSurface()
      return false
    }

    const levelY = floorMinY - ORBIT_FLOOR_CLEARANCE
    if (levelY !== this.surfaceLevelY) {
      this.forgetFloorSurface()
      this.surfaceLevelY = levelY
    }
    const knownLimitY = this.surfaceMinY ?? floorMinY
    const endCameraY =
      this._targetEnd.y -
      this.floorShift.y +
      this._sphericalEnd.radius * Math.cos(this._sphericalEnd.phi - this.polarShift)
    if (this.heldFloorMinY !== floorMinY || endCameraY >= knownLimitY) {
      this.heldMinY = null
      this.heldFloorMinY = floorMinY
    }
    // The orbit never aims below the level's floor: the pivot's destination is
    // lifted, so a transition toward it glides rather than jumps.
    const pivotEndY = this._targetEnd.y - this.floorShift.y
    if (this.heldMinY === null && pivotEndY < levelY) {
      this._targetEnd.y += levelY - pivotEndY
      this._needsUpdate = true
    }

    const { radius, theta } = this._spherical
    const orbitPolar = this._spherical.phi - this.polarShift
    virtualTarget.copy(this._target).sub(this.floorShift)
    virtualPosition.setFromSphericalCoords(radius, orbitPolar, theta).add(virtualTarget)
    // Where the camera is headed at the limit known so far; then the floor
    // under that spot, in the same pass, so no motion skips the lookup.
    let minY = this.heldLimit(knownLimitY)
    let drawnPolar = orbitCameraAboveFloor(groundedPosition, virtualPosition, virtualTarget, minY)
    const limitY = this.resolveFloorLimit(groundedPosition, levelY)
    if (limitY !== knownLimitY) {
      minY = this.heldLimit(limitY)
      drawnPolar = orbitCameraAboveFloor(groundedPosition, virtualPosition, virtualTarget, minY)
    }
    // The drawn target sits the orbit's distance out along the drawn view.
    drawnTarget.setFromSphericalCoords(radius, drawnPolar, theta).negate().add(groundedPosition)
    shiftDelta.subVectors(drawnTarget, this._target)
    const polarDelta = drawnPolar - orbitPolar - this.polarShift
    if (shiftDelta.lengthSq() < 1e-12 && Math.abs(polarDelta) < 1e-9) return false

    this._target.add(shiftDelta)
    this._targetEnd.add(shiftDelta)
    this._spherical.phi += polarDelta
    this._sphericalEnd.phi += polarDelta
    this.floorShift.add(shiftDelta)
    this.polarShift += polarDelta
    this._camera.position.copy(groundedPosition)
    this._camera.lookAt(this._target)
    this._needsUpdate = true
    return true
  }

  /**
   * The user has taken over: a written pose under the clearance stops being
   * held, and the limit eases up from where the camera is rather than popping.
   */
  releaseWrittenPose() {
    if (this.heldMinY === null) return
    this.heldMinY = null
    const y = this._camera.position.y
    this.surfaceMinY = Math.min(this.surfaceMinY ?? y, y)
  }

  // A written pose may sit under the clearance, but not under the floor itself.
  private heldLimit(limitY: number) {
    if (this.heldMinY === null) return limitY
    return Math.min(limitY, Math.max(this.heldMinY, limitY - ORBIT_FLOOR_CLEARANCE))
  }

  private forgetFloorSurface() {
    this.surfaceMinY = null
    this.surfaceTop = null
    this.surfaceQuery.revision = -1
  }

  /**
   * The floor limit at `position`: the clearance above the floor surface under
   * it, eased once per frame as the floor height changes. Over a hole, or
   * while a slab is rebuilt, the last floor found on this level holds; with
   * none found yet, the level's own floor does. Far above the floor nothing
   * is cast and the floor is forgotten.
   */
  private resolveFloorLimit(position: Vector3, levelY: number) {
    const surface = this.floorSurface
    if (!surface || position.y > levelY + ORBIT_FLOOR_CLEARANCE + SURFACE_BAND) {
      this.forgetFloorSurface()
      return levelY + ORBIT_FLOOR_CLEARANCE
    }

    const query = this.surfaceQuery
    const revision = surface.revision
    if (position.x !== query.x || position.z !== query.z || revision !== query.revision) {
      query.x = position.x
      query.z = position.z
      query.revision = revision
      query.top = surface.topAt(position.x, position.z, levelY)
      if (query.top !== null) this.surfaceTop = query.top
    }
    const floorTop = this.surfaceTop ?? levelY
    const step = this.glideFrame === this.frame ? 0 : this.frameDelta
    this.glideFrame = this.frame
    const limit = Math.max(
      glideFloorLimit(this.surfaceMinY, floorLimitAt(floorTop, levelY), step),
      floorTop + SURFACE_MIN_GAP,
    )
    this.surfaceMinY = limit
    return limit
  }
}
