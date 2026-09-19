import { Box3, Line3, Matrix4, type Mesh, Quaternion, Vector3 } from 'three'

const CAPSULE_RADIUS = 0.25
const CAPSULE_SEGMENT_LENGTH = 0.8
const CAPSULE_CENTER_FROM_EYE = 0.85
const MAX_MOVEMENT_STEP = 0.1
const COLLISION_ITERATIONS = 3
const EPSILON = 1e-10

const inverseMatrix = new Matrix4()
const colliderScale = new Vector3()
const colliderPosition = new Vector3()
const colliderQuaternion = new Quaternion()
const worldSegment = new Line3(new Vector3(), new Vector3())
const localSegment = new Line3(new Vector3(), new Vector3())
const localBounds = new Box3()
const trianglePoint = new Vector3()
const capsulePoint = new Vector3()
const pushDirection = new Vector3()
const desiredWorldStart = new Vector3()
const resolvedWorldStart = new Vector3()
const correction = new Vector3()
const currentPosition = new Vector3()
const desiredPosition = new Vector3()
const stepMovement = new Vector3()
const roomMovement = new Vector3()
const resolvedRoomMovement = new Vector3()

type BvhGeometry = Mesh['geometry'] & {
  boundsTree?: {
    shapecast(callbacks: {
      intersectsBounds(bounds: Box3): boolean
      intersectsTriangle(triangle: {
        closestPointToSegment(segment: Line3, trianglePoint: Vector3, capsulePoint: Vector3): number
        getNormal(target: Vector3): Vector3
      }): boolean
    }): void
  }
}

function resolveColliderPenetration(collider: Mesh, eyePosition: Vector3) {
  const geometry = collider.geometry as BvhGeometry
  if (!geometry.boundsTree) return correction.set(0, 0, 0)

  collider.updateWorldMatrix(true, false)
  inverseMatrix.copy(collider.matrixWorld).invert()
  collider.matrixWorld.decompose(colliderPosition, colliderQuaternion, colliderScale)
  const minimumScale = Math.max(
    EPSILON,
    Math.min(Math.abs(colliderScale.x), Math.abs(colliderScale.y), Math.abs(colliderScale.z)),
  )
  const localRadius = CAPSULE_RADIUS / minimumScale
  const halfSegment = CAPSULE_SEGMENT_LENGTH / 2
  const centerY = eyePosition.y - CAPSULE_CENTER_FROM_EYE
  worldSegment.start.set(eyePosition.x, centerY + halfSegment, eyePosition.z)
  worldSegment.end.set(eyePosition.x, centerY - halfSegment, eyePosition.z)
  desiredWorldStart.copy(worldSegment.start)
  localSegment.copy(worldSegment).applyMatrix4(inverseMatrix)

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration += 1) {
    localBounds
      .makeEmpty()
      .expandByPoint(localSegment.start)
      .expandByPoint(localSegment.end)
      .expandByScalar(localRadius)
    let collided = false
    geometry.boundsTree.shapecast({
      intersectsBounds: (bounds) => bounds.intersectsBox(localBounds),
      intersectsTriangle: (triangle) => {
        const distance = triangle.closestPointToSegment(localSegment, trianglePoint, capsulePoint)
        if (distance >= localRadius) return false
        pushDirection.copy(capsulePoint).sub(trianglePoint)
        if (pushDirection.lengthSq() <= EPSILON) triangle.getNormal(pushDirection)
        else pushDirection.normalize()
        localSegment.start.addScaledVector(pushDirection, localRadius - distance)
        localSegment.end.addScaledVector(pushDirection, localRadius - distance)
        collided = true
        return false
      },
    })
    if (!collided) break
  }

  resolvedWorldStart.copy(localSegment.start).applyMatrix4(collider.matrixWorld)
  return correction.copy(resolvedWorldStart).sub(desiredWorldStart)
}

export function resolveCapsuleTranslation(
  colliders: readonly Mesh[],
  playerPosition: Vector3,
  movement: Vector3,
  target: Vector3,
) {
  const distance = movement.length()
  if (!Number.isFinite(distance)) return target.set(0, 0, 0)
  const steps = Math.max(1, Math.ceil(distance / MAX_MOVEMENT_STEP))
  stepMovement.copy(movement).divideScalar(steps)
  currentPosition.copy(playerPosition)

  for (let step = 0; step < steps; step += 1) {
    desiredPosition.copy(currentPosition).add(stepMovement)
    for (const collider of colliders) {
      desiredPosition.add(resolveColliderPenetration(collider, desiredPosition))
    }
    currentPosition.copy(desiredPosition)
  }
  return target.copy(currentPosition).sub(playerPosition)
}

export function resolveRoomScaleOriginCorrection(
  colliders: readonly Mesh[],
  previousPlayerPosition: Vector3,
  currentPlayerPosition: Vector3,
  target: Vector3,
) {
  roomMovement.copy(currentPlayerPosition).sub(previousPlayerPosition)
  resolveCapsuleTranslation(colliders, previousPlayerPosition, roomMovement, resolvedRoomMovement)
  return target.copy(resolvedRoomMovement).sub(roomMovement)
}
