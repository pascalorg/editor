import { CameraControlsImpl } from '@react-three/drei'
import { Vector3 } from 'three'
import { orbitCameraAboveFloor } from '../../lib/orbit-floor-clearance'

const virtualTarget = new Vector3()
const virtualPosition = new Vector3()
const groundedPosition = new Vector3()
const nextShift = new Vector3()
const shiftDelta = new Vector3()

/**
 * Orbit controls whose own state never puts a perspective camera under the
 * floor. The floor push is applied to the controls' target and position, so
 * every reader (`getPosition`, `getTarget`, `camera.position`, truck speed,
 * snapshots) sees the pose that is drawn. `floorShift` is the push currently
 * applied; the orbit underneath it is what a later rotate or zoom continues
 * from, which is why orbiting back up returns the exact earlier pose.
 */
export class FloorAwareCameraControls extends CameraControlsImpl {
  /** World Y the camera may not sink below; null turns the floor off. */
  floorMinY: number | null = null
  private readonly floorShift = new Vector3()
  // A pose written with `setLookAt` (applied pose, saved view, snapshot
  // replay) is shown exactly, even under the clearance; the floor holds at
  // its height until the orbit heads back above the clearance or the floor
  // itself changes (another level).
  private heldMinY: number | null = null
  private heldFloorMinY: number | null = null
  private relativeMove = false
  private readonly floorUpdateEvent = { type: 'update' }

  // Level navigation translates the orbit's floor, rather than its pushed target.
  getOrbitTarget(out: Vector3) {
    return this.getTarget(out).sub(this.floorShift)
  }

  override moveTo(x: number, y: number, z: number, enableTransition = false) {
    // Absolute destinations replace the orbit; trucks keep its remembered push.
    if (!this.relativeMove) {
      this.floorShift.set(0, 0, 0)
      this.heldMinY = null
    }
    return super.moveTo(x, y, z, enableTransition)
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
    this.heldMinY = positionY
    this.heldFloorMinY = this.floorMinY
    return done
  }

  override update(delta: number): boolean {
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
      this.heldMinY = null
      return false
    }

    const endCameraY =
      this._targetEnd.y -
      this.floorShift.y +
      this._sphericalEnd.radius * Math.cos(this._sphericalEnd.phi)
    if (this.heldFloorMinY !== floorMinY || endCameraY >= floorMinY) this.heldMinY = null
    const minY = this.heldMinY === null ? floorMinY : Math.min(floorMinY, this.heldMinY)

    virtualTarget.copy(this._target).sub(this.floorShift)
    virtualPosition.copy(this._camera.position).sub(this.floorShift)
    if (orbitCameraAboveFloor(groundedPosition, virtualPosition, virtualTarget, minY)) {
      nextShift.subVectors(groundedPosition, virtualPosition)
    } else {
      nextShift.set(0, 0, 0)
    }
    shiftDelta.subVectors(nextShift, this.floorShift)
    if (shiftDelta.lengthSq() < 1e-12) return false

    this._target.add(shiftDelta)
    this._targetEnd.add(shiftDelta)
    this._camera.position.add(shiftDelta)
    this.floorShift.copy(nextShift)
    this._needsUpdate = true
    return true
  }
}
