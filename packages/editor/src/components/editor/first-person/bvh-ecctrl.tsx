import '../../../three-types'
import { TransformControls, useKeyboardControls } from '@react-three/drei'
import { useFrame, useThree, type ThreeElements } from '@react-three/fiber'
import {
  Suspense,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { clamp } from 'three/src/math/MathUtils.js'

export type MovementInput = {
  forward?: boolean
  backward?: boolean
  leftward?: boolean
  rightward?: boolean
  joystick?: { x: number; y: number }
  run?: boolean
  jump?: boolean
}

export type CharacterAnimationStatus =
  | 'IDLE'
  | 'WALK'
  | 'RUN'
  | 'JUMP_START'
  | 'JUMP_IDLE'
  | 'JUMP_FALL'
  | 'JUMP_LAND'

export type FloatCheckType = 'RAYCAST' | 'SHAPECAST' | 'BOTH'

export interface BVHEcctrlApi {
  group: THREE.Group | null
  model: THREE.Group | null
  resetLinVel: () => void
  addLinVel: (v: THREE.Vector3) => void
  setLinVel: (v: THREE.Vector3) => void
  setMovement: (input: MovementInput) => void
}

export interface EcctrlProps extends Omit<ThreeElements['group'], 'ref'> {
  children?: ReactNode
  debug?: boolean
  colliderMeshes?: THREE.Mesh[]
  colliderCapsuleArgs?: [
    radius: number,
    length: number,
    capSegments: number,
    radialSegments: number,
  ]
  paused?: boolean
  delay?: number
  gravity?: number
  fallGravityFactor?: number
  maxFallSpeed?: number
  mass?: number
  sleepTimeout?: number
  slowMotionFactor?: number
  turnSpeed?: number
  maxWalkSpeed?: number
  maxRunSpeed?: number
  acceleration?: number
  deceleration?: number
  counterAccFactor?: number
  airDragFactor?: number
  jumpVel?: number
  floatCheckType?: FloatCheckType
  maxSlope?: number
  floatHeight?: number
  floatPullBackHeight?: number
  floatSensorRadius?: number
  floatSpringK?: number
  floatDampingC?: number
  collisionCheckIteration?: number
  collisionPushBackDamping?: number
  collisionPushBackThreshold?: number
}

type CharacterStatus = {
  position: THREE.Vector3
  linvel: THREE.Vector3
  quaternion: THREE.Quaternion
  inputDir: THREE.Vector3
  movingDir: THREE.Vector3
  isOnGround: boolean
  isOnMovingPlatform: boolean
  animationStatus: CharacterAnimationStatus
}

export const characterStatus: CharacterStatus = {
  position: new THREE.Vector3(),
  linvel: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  inputDir: new THREE.Vector3(),
  movingDir: new THREE.Vector3(),
  isOnGround: false,
  isOnMovingPlatform: false,
  animationStatus: 'IDLE',
}

const BVHEcctrl = forwardRef<BVHEcctrlApi, EcctrlProps>(
  (
    {
      children,
      debug = false,
      colliderMeshes = [],
      colliderCapsuleArgs = [0.3, 0.6, 4, 8],
      paused = false,
      delay = 1.5,
      gravity = 9.81,
      fallGravityFactor = 4,
      maxFallSpeed = 50,
      mass = 1,
      sleepTimeout = 10,
      slowMotionFactor = 1,
      turnSpeed = 15,
      maxWalkSpeed = 3,
      maxRunSpeed = 5,
      acceleration = 30,
      deceleration = 20,
      counterAccFactor = 0.5,
      airDragFactor = 0.3,
      jumpVel = 5,
      floatCheckType = 'BOTH',
      maxSlope = 1,
      floatHeight = 0.2,
      floatPullBackHeight = 0.25,
      floatSensorRadius = 0.12,
      floatSpringK = 600,
      floatDampingC = 28,
      collisionCheckIteration = 3,
      collisionPushBackDamping = 0.1,
      collisionPushBackThreshold = 0.05,
      ...props
    },
    ref,
  ) => {
    const { camera } = useThree()
    const capsuleRadius = useMemo(() => colliderCapsuleArgs[0], [colliderCapsuleArgs])
    const capsuleLength = useMemo(() => colliderCapsuleArgs[1], [colliderCapsuleArgs])
    const characterGroupRef = useRef<THREE.Group | null>(null)
    const characterColliderRef = useRef<THREE.Mesh | null>(null)
    const characterModelRef = useRef<THREE.Group | null>(null)
    const debugLineStart = useRef<THREE.Mesh | null>(null)
    const debugLineEnd = useRef<THREE.Mesh | null>(null)
    const debugRaySensorStart = useRef<THREE.Mesh | null>(null)
    const debugRaySensorEnd = useRef<THREE.Mesh | null>(null)
    const standPointRef = useRef<THREE.Mesh | null>(null)
    const lookDirRef = useRef<THREE.Mesh | null>(null)
    const inputDirRef = useRef<THREE.ArrowHelper | null>(null)
    const moveDirRef = useRef<THREE.ArrowHelper | null>(null)
    const elapsedRef = useRef(0)

    function useIsInsideKeyboardControls() {
      try {
        return !!useKeyboardControls()
      } catch {
        return false
      }
    }

    const isInsideKeyboardControls = useIsInsideKeyboardControls()
    const [_, getKeys] = isInsideKeyboardControls ? useKeyboardControls() : [null, null]
    const presetKeys = {
      forward: false,
      backward: false,
      leftward: false,
      rightward: false,
      jump: false,
      run: false,
    }

    const upAxis = useRef(new THREE.Vector3(0, 1, 0))
    const localUpAxis = useRef(new THREE.Vector3())
    const gravityDir = useRef(new THREE.Vector3(0, -1, 0))
    const currentLinVel = useRef(new THREE.Vector3())
    const currentLinVelOnPlane = useRef(new THREE.Vector3())
    const isFalling = useRef(false)
    const idleTime = useRef(0)
    const isSleeping = useRef(false)
    const camProjDir = useRef(new THREE.Vector3())
    const camRightDir = useRef(new THREE.Vector3())
    const inputDir = useRef(new THREE.Vector3())
    const inputDirOnPlane = useRef(new THREE.Vector3())
    const movingDir = useRef(new THREE.Vector3())
    const deltaLinVel = useRef(new THREE.Vector3())
    const wantToMoveVel = useRef(new THREE.Vector3())
    const forwardState = useRef(false)
    const backwardState = useRef(false)
    const leftwardState = useRef(false)
    const rightwardState = useRef(false)
    const joystickState = useRef(new THREE.Vector2())
    const runState = useRef(false)
    const jumpState = useRef(false)
    const isOnGround = useRef(false)
    const prevIsOnGround = useRef(false)
    const prevAnimation = useRef<CharacterAnimationStatus>('IDLE')
    const characterModelTargetQuat = useRef(new THREE.Quaternion())
    const characterModelLookMatrix = useRef(new THREE.Matrix4())
    const characterOrigin = useMemo(() => new THREE.Vector3(0, 0, 0), [])
    const contactDepth = useRef(0)
    const contactNormal = useRef(new THREE.Vector3())
    const triContactPoint = useRef(new THREE.Vector3())
    const capsuleContactPoint = useRef(new THREE.Vector3())
    const totalDepth = useRef(0)
    const triangleCount = useRef(0)
    const accumulatedContactNormal = useRef(new THREE.Vector3())
    const accumulatedContactPoint = useRef(new THREE.Vector3())
    const absorbVel = useRef(new THREE.Vector3())
    const pushBackVel = useRef(new THREE.Vector3())
    const characterBbox = useRef(new THREE.Box3())
    const characterSegment = useRef(new THREE.Line3())
    const localCharacterBbox = useRef(new THREE.Box3())
    const localCharacterSegment = useRef(new THREE.Line3())
    const collideInvertMatrix = useRef(new THREE.Matrix4())
    const relativeCollideVel = useRef(new THREE.Vector3())
    const scaledContactRadiusVec = useRef(new THREE.Vector3())
    const deltaDist = useRef(new THREE.Vector3())
    const currSlopeAngle = useRef(0)
    const localMinDistance = useRef(Infinity)
    const localClosestPoint = useRef(new THREE.Vector3())
    const localHitNormal = useRef(new THREE.Vector3())
    const triNormal = useRef(new THREE.Vector3())
    const globalMinDistance = useRef(Infinity)
    const globalClosestPoint = useRef(new THREE.Vector3())
    const triHitPoint = useRef(new THREE.Vector3())
    const segHitPoint = useRef(new THREE.Vector3())
    const floatHitNormal = useRef(new THREE.Vector3())
    const groundFriction = useRef(0.8)
    const floatSensorBbox = useRef(new THREE.Box3())
    const floatSensorBboxExpendPoint = useRef(new THREE.Vector3())
    const floatSensorSegment = useRef(new THREE.Line3())
    const localFloatSensorBbox = useRef(new THREE.Box3())
    const localFloatSensorBboxExpendPoint = useRef(new THREE.Vector3())
    const localFloatSensorSegment = useRef(new THREE.Line3())
    const floatInvertMatrix = useRef(new THREE.Matrix4())
    const floatNormalInverseMatrix = useRef(new THREE.Matrix3())
    const floatNormalMatrix = useRef(new THREE.Matrix3())
    const floatRaycaster = useRef(new THREE.Raycaster())
    const relativeHitPoint = useRef(new THREE.Vector3())
    const totalPlatformDeltaPos = useRef(new THREE.Vector3())
    const isOnMovingPlatform = useRef(false)
    const floatTempPos = useRef(new THREE.Vector3())
    const floatTempQuat = useRef(new THREE.Quaternion())
    const floatTempScale = useRef(new THREE.Vector3())
    const scaledFloatRadiusVec = useRef(new THREE.Vector3())
    const deltaHit = useRef(new THREE.Vector3())
    const rotationDeltaPos = useRef(new THREE.Vector3())
    const yawQuaternion = useRef(new THREE.Quaternion())
    const contactTempPos = useRef(new THREE.Vector3())
    const contactTempQuat = useRef(new THREE.Quaternion())
    const contactTempScale = useRef(new THREE.Vector3())

    floatRaycaster.current.far = capsuleRadius + floatHeight + floatPullBackHeight

    const floatRaycastCandidates = useMemo(
      () =>
        colliderMeshes.filter(
          (mesh) => mesh.geometry.boundsTree && !(mesh instanceof THREE.InstancedMesh),
        ),
      [colliderMeshes],
    )

    const applyGravity = useCallback(
      (delta: number) => {
        gravityDir.current.copy(upAxis.current).negate()
        const fallingSpeed = currentLinVel.current.dot(gravityDir.current)
        isFalling.current = fallingSpeed > 0
        if (fallingSpeed < maxFallSpeed) {
          currentLinVel.current.addScaledVector(
            gravityDir.current,
            gravity * (isFalling.current ? fallGravityFactor : 1) * delta,
          )
        }
      },
      [fallGravityFactor, gravity, maxFallSpeed],
    )

    const checkCharacterSleep = useCallback(
      (jump: boolean, delta: number) => {
        const moving = currentLinVel.current.lengthSq() > 1e-6
        const platformIsMoving = totalPlatformDeltaPos.current.lengthSq() > 1e-6

        if (!moving && isOnGround.current && !jump && !isOnMovingPlatform.current && !platformIsMoving) {
          idleTime.current += delta
          if (idleTime.current > sleepTimeout) isSleeping.current = true
        } else {
          idleTime.current = 0
          isSleeping.current = false
        }
      },
      [sleepTimeout],
    )

    const setInputDirection = useCallback(
      (dir: {
        forward?: boolean
        backward?: boolean
        leftward?: boolean
        rightward?: boolean
        joystick?: THREE.Vector2
      }) => {
        inputDir.current.set(0, 0, 0)

        camera.getWorldDirection(camProjDir.current)
        camProjDir.current.projectOnPlane(upAxis.current).normalize()
        camRightDir.current.crossVectors(camProjDir.current, upAxis.current).normalize()

        if (dir.joystick && dir.joystick.lengthSq() > 0) {
          inputDir.current
            .addScaledVector(camProjDir.current, dir.joystick.y)
            .addScaledVector(camRightDir.current, dir.joystick.x)
        } else {
          if (dir.forward) inputDir.current.add(camProjDir.current)
          if (dir.backward) inputDir.current.sub(camProjDir.current)
          if (dir.leftward) inputDir.current.sub(camRightDir.current)
          if (dir.rightward) inputDir.current.add(camRightDir.current)
        }

        inputDir.current.normalize()
      },
      [camera],
    )

    const handleCharacterMovement = useCallback(
      (run: boolean, delta: number) => {
        const friction = clamp(groundFriction.current, 0, 1)

        if (inputDir.current.lengthSq() > 0) {
          if (characterModelRef.current) {
            inputDirOnPlane.current.copy(inputDir.current).projectOnPlane(upAxis.current)
            characterModelLookMatrix.current.lookAt(
              inputDirOnPlane.current,
              characterOrigin,
              upAxis.current,
            )
            characterModelTargetQuat.current.setFromRotationMatrix(characterModelLookMatrix.current)
            characterModelRef.current.quaternion.slerp(characterModelTargetQuat.current, delta * turnSpeed)
          }

          const maxSpeed = run ? maxRunSpeed : maxWalkSpeed
          wantToMoveVel.current.copy(inputDir.current).multiplyScalar(maxSpeed)
          const dot = movingDir.current.dot(inputDir.current)

          deltaLinVel.current.subVectors(wantToMoveVel.current, currentLinVelOnPlane.current)
          deltaLinVel.current.clampLength(
            0,
            (dot <= 0 ? 1 + counterAccFactor : 1) *
              acceleration *
              friction *
              delta *
              (isOnGround.current ? 1 : airDragFactor),
          )
          currentLinVel.current.add(deltaLinVel.current)
        } else if (isOnGround.current) {
          deltaLinVel.current.copy(currentLinVelOnPlane.current).clampLength(0, deceleration * friction * delta)
          currentLinVel.current.sub(deltaLinVel.current)
        }
      },
      [acceleration, airDragFactor, counterAccFactor, deceleration, maxRunSpeed, maxWalkSpeed, turnSpeed, characterOrigin],
    )

    const updateSegmentBBox = useCallback(() => {
      if (!characterGroupRef.current) return

      characterSegment.current.start.set(0, capsuleLength / 2, 0).add(characterGroupRef.current.position)
      characterSegment.current.end.set(0, -capsuleLength / 2, 0).add(characterGroupRef.current.position)

      characterBbox.current
        .makeEmpty()
        .expandByPoint(characterSegment.current.start)
        .expandByPoint(characterSegment.current.end)
        .expandByScalar(capsuleRadius)

      floatSensorSegment.current.start.copy(characterSegment.current.end)
      floatSensorSegment.current.end
        .copy(floatSensorSegment.current.start)
        .addScaledVector(gravityDir.current, floatHeight + capsuleRadius)
      floatSensorBboxExpendPoint.current
        .copy(floatSensorSegment.current.end)
        .addScaledVector(gravityDir.current, floatPullBackHeight)

      floatSensorBbox.current
        .makeEmpty()
        .expandByPoint(floatSensorSegment.current.start)
        .expandByPoint(floatSensorBboxExpendPoint.current)
        .expandByScalar(floatSensorRadius)
    }, [capsuleLength, capsuleRadius, floatHeight, floatPullBackHeight, floatSensorRadius])

    const collisionCheck = useCallback(
      (mesh: THREE.Mesh, originMatrix: THREE.Matrix4, delta: number) => {
        if (!mesh.visible || !mesh.geometry.boundsTree || mesh.userData.excludeCollisionCheck) return

        originMatrix.decompose(contactTempPos.current, contactTempQuat.current, contactTempScale.current)
        collideInvertMatrix.current.copy(originMatrix).invert()
        localCharacterSegment.current.copy(characterSegment.current).applyMatrix4(collideInvertMatrix.current)

        scaledContactRadiusVec.current.set(
          capsuleRadius / contactTempScale.current.x,
          capsuleRadius / contactTempScale.current.y,
          capsuleRadius / contactTempScale.current.z,
        )

        localCharacterBbox.current
          .makeEmpty()
          .expandByPoint(localCharacterSegment.current.start)
          .expandByPoint(localCharacterSegment.current.end)
        localCharacterBbox.current.min.addScaledVector(scaledContactRadiusVec.current, -1)
        localCharacterBbox.current.max.add(scaledContactRadiusVec.current)

        contactDepth.current = 0
        contactNormal.current.set(0, 0, 0)
        absorbVel.current.set(0, 0, 0)
        pushBackVel.current.set(0, 0, 0)
        totalDepth.current = 0
        triangleCount.current = 0
        accumulatedContactNormal.current.set(0, 0, 0)
        accumulatedContactPoint.current.set(0, 0, 0)

        mesh.geometry.boundsTree.shapecast({
          intersectsBounds: (box) => box.intersectsBox(localCharacterBbox.current),
          intersectsTriangle: (tri) => {
            tri.closestPointToSegment(
              localCharacterSegment.current,
              triContactPoint.current,
              capsuleContactPoint.current,
            )

            deltaDist.current.copy(triContactPoint.current).sub(capsuleContactPoint.current)
            deltaDist.current.divide(scaledContactRadiusVec.current)

            if (deltaDist.current.lengthSq() < 1) {
              triContactPoint.current.applyMatrix4(originMatrix)
              capsuleContactPoint.current.applyMatrix4(originMatrix)

              contactNormal.current
                .copy(capsuleContactPoint.current)
                .sub(triContactPoint.current)
                .normalize()
              contactDepth.current =
                capsuleRadius - capsuleContactPoint.current.distanceTo(triContactPoint.current)

              accumulatedContactNormal.current.addScaledVector(contactNormal.current, contactDepth.current)
              accumulatedContactPoint.current.add(triContactPoint.current)
              totalDepth.current += contactDepth.current
              triangleCount.current += 1
            }
          },
        })

        if (triangleCount.current > 0) {
          accumulatedContactNormal.current.normalize()
          accumulatedContactPoint.current.divideScalar(triangleCount.current)
          const avgDepth = totalDepth.current / triangleCount.current
          relativeCollideVel.current.copy(currentLinVel.current)
          const intoSurfaceVel = relativeCollideVel.current.dot(accumulatedContactNormal.current)

          if (intoSurfaceVel < 0) {
            absorbVel.current
              .copy(accumulatedContactNormal.current)
              .multiplyScalar(-intoSurfaceVel * (1 + (mesh.userData.restitution ?? 0.05)))
            currentLinVel.current.add(absorbVel.current)
          }

          if (avgDepth > collisionPushBackThreshold) {
            const correction = (collisionPushBackDamping / delta) * avgDepth
            pushBackVel.current.copy(accumulatedContactNormal.current).multiplyScalar(correction)
            currentLinVel.current.add(pushBackVel.current)
          }
        }
      },
      [capsuleRadius, collisionPushBackDamping, collisionPushBackThreshold],
    )

    const handleCollisionResponse = useCallback(
      (meshes: THREE.Mesh[], delta: number) => {
        if (meshes.length === 0) return

        for (let iteration = 0; iteration < collisionCheckIteration; iteration += 1) {
          for (const mesh of meshes) {
            collisionCheck(mesh, mesh.matrixWorld, delta)
          }
        }
      },
      [collisionCheck, collisionCheckIteration],
    )

    const floatingCheck = useCallback(
      (mesh: THREE.Mesh, originMatrix: THREE.Matrix4) => {
        if (!mesh.visible || !mesh.geometry.boundsTree || mesh.userData.excludeFloatHit) return

        originMatrix.decompose(floatTempPos.current, floatTempQuat.current, floatTempScale.current)
        floatInvertMatrix.current.copy(originMatrix).invert()
        floatNormalInverseMatrix.current.getNormalMatrix(floatInvertMatrix.current)
        floatNormalMatrix.current.getNormalMatrix(originMatrix)

        localFloatSensorSegment.current.copy(floatSensorSegment.current).applyMatrix4(floatInvertMatrix.current)
        localFloatSensorBboxExpendPoint.current
          .copy(floatSensorBboxExpendPoint.current)
          .applyMatrix4(floatInvertMatrix.current)

        scaledFloatRadiusVec.current.set(
          floatSensorRadius / floatTempScale.current.x,
          floatSensorRadius / floatTempScale.current.y,
          floatSensorRadius / floatTempScale.current.z,
        )

        localFloatSensorBbox.current
          .makeEmpty()
          .expandByPoint(localFloatSensorSegment.current.start)
          .expandByPoint(localFloatSensorBboxExpendPoint.current)
        localFloatSensorBbox.current.min.addScaledVector(scaledFloatRadiusVec.current, -1)
        localFloatSensorBbox.current.max.add(scaledFloatRadiusVec.current)

        localMinDistance.current = Infinity
        localClosestPoint.current.set(Infinity, Infinity, Infinity)

        mesh.geometry.boundsTree.shapecast({
          intersectsBounds: (box) => box.intersectsBox(localFloatSensorBbox.current),
          intersectsTriangle: (tri) => {
            tri.closestPointToSegment(localFloatSensorSegment.current, triHitPoint.current, segHitPoint.current)
            localUpAxis.current.copy(upAxis.current).applyMatrix3(floatNormalInverseMatrix.current).normalize()
            deltaHit.current.subVectors(triHitPoint.current, localFloatSensorSegment.current.start)
            deltaHit.current.divide(scaledFloatRadiusVec.current)

            const totalLengthSq = deltaHit.current.lengthSq()
            const dot = deltaHit.current.dot(localUpAxis.current)
            const verticalLength = Math.abs(dot) / ((capsuleRadius + floatHeight + floatPullBackHeight) / floatSensorRadius)
            const horizontalLength = Math.sqrt(Math.max(0, totalLengthSq - dot * dot))

            if (horizontalLength < 1 && verticalLength < 1) {
              tri.getNormal(triNormal.current)
              triNormal.current.applyMatrix3(floatNormalMatrix.current).normalize()
              triHitPoint.current.applyMatrix4(originMatrix)

              const slopeAngle = triNormal.current.angleTo(upAxis.current)
              if (verticalLength < localMinDistance.current && slopeAngle < maxSlope) {
                localMinDistance.current = verticalLength
                localClosestPoint.current.copy(triHitPoint.current)
                localHitNormal.current.copy(triNormal.current)
              }
            }
          },
        })

        if (localMinDistance.current < globalMinDistance.current) {
          globalMinDistance.current = localMinDistance.current
          globalClosestPoint.current.copy(localClosestPoint.current)
          floatHitNormal.current.copy(localHitNormal.current)
        }
      },
      [capsuleRadius, floatHeight, floatPullBackHeight, floatSensorRadius, maxSlope],
    )

    const handleFloatingResponse = useCallback(
      (meshes: THREE.Mesh[], jump: boolean, delta: number) => {
        if (meshes.length === 0) return

        globalMinDistance.current = Infinity
        globalClosestPoint.current.set(Infinity, Infinity, Infinity)
        floatHitNormal.current.set(0, 1, 0)
        isOnGround.current = false
        totalPlatformDeltaPos.current.set(0, 0, 0)
        isOnMovingPlatform.current = false

        if (floatCheckType !== 'RAYCAST') {
          for (const mesh of meshes) {
            floatingCheck(mesh, mesh.matrixWorld)
          }
        }

        if (floatCheckType !== 'SHAPECAST' && floatRaycastCandidates.length > 0 && globalMinDistance.current === Infinity) {
          floatRaycaster.current.ray.origin.copy(floatSensorSegment.current.start)
          floatRaycaster.current.ray.direction.copy(gravityDir.current)
          const hits = floatRaycaster.current.intersectObjects(floatRaycastCandidates, false)
          const hit = hits[0]
          if (hit?.point) {
            globalClosestPoint.current.copy(hit.point)
            if (hit.face) {
              floatHitNormal.current.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
            }
          }
        }

        if (globalClosestPoint.current.x === Infinity) return

        relativeHitPoint.current.copy(globalClosestPoint.current).sub(floatSensorSegment.current.start)
        const currentDistance = relativeHitPoint.current.length()
        currSlopeAngle.current = floatHitNormal.current.angleTo(upAxis.current)

        if (currentDistance < floatHeight + capsuleRadius) {
          isOnGround.current = true
          jump = false
        }

        if (!jump) {
          const displacement = floatHeight + capsuleRadius - currentDistance
          const velocityOnHitNormal = currentLinVel.current.dot(floatHitNormal.current)
          const springForce = displacement * floatSpringK
          const dampingForce = -velocityOnHitNormal * floatDampingC
          const totalForce = springForce + dampingForce - mass * gravity

          currentLinVel.current.addScaledVector(floatHitNormal.current, (totalForce / mass) * delta)
        }
      },
      [capsuleRadius, floatCheckType, floatDampingC, floatHeight, floatRaycastCandidates, floatSpringK, floatingCheck, gravity, mass],
    )

    const updateCharacterWithPlatform = useCallback(() => {
      if (!characterGroupRef.current) return
      rotationDeltaPos.current.copy(totalPlatformDeltaPos.current)
      characterGroupRef.current.position.add(rotationDeltaPos.current)
      yawQuaternion.current.setFromUnitVectors(upAxis.current, floatHitNormal.current)
    }, [upAxis])

    const updateCharacterAnimation = useCallback(
      (run: boolean, jump: boolean): CharacterAnimationStatus => {
        if (prevIsOnGround.current && jump) return 'JUMP_START'
        if (!isOnGround.current && currentLinVel.current.y > 0) return 'JUMP_IDLE'
        if (!isOnGround.current && currentLinVel.current.y <= 0) return 'JUMP_FALL'
        if (!prevIsOnGround.current && isOnGround.current) return 'JUMP_LAND'
        if (inputDir.current.lengthSq() > 0) return run ? 'RUN' : 'WALK'
        return 'IDLE'
      },
      [],
    )

    const updateCharacterStatus = useCallback(
      (run: boolean, jump: boolean) => {
        characterModelRef.current?.getWorldPosition(characterStatus.position)
        characterModelRef.current?.getWorldQuaternion(characterStatus.quaternion)
        characterStatus.linvel.copy(currentLinVel.current)
        characterStatus.inputDir.copy(inputDir.current)
        characterStatus.movingDir.copy(movingDir.current)
        characterStatus.isOnGround = isOnGround.current
        characterStatus.isOnMovingPlatform = isOnMovingPlatform.current
        characterStatus.animationStatus = updateCharacterAnimation(run, jump)
        prevAnimation.current = characterStatus.animationStatus
      },
      [updateCharacterAnimation],
    )

    const resetLinVel = useCallback(() => currentLinVel.current.set(0, 0, 0), [])
    const addLinVel = useCallback((velocity: THREE.Vector3) => currentLinVel.current.add(velocity), [])
    const setLinVel = useCallback((velocity: THREE.Vector3) => currentLinVel.current.copy(velocity), [])
    const setMovement = useCallback((movement: MovementInput) => {
      if (movement.forward !== undefined) forwardState.current = movement.forward
      if (movement.backward !== undefined) backwardState.current = movement.backward
      if (movement.leftward !== undefined) leftwardState.current = movement.leftward
      if (movement.rightward !== undefined) rightwardState.current = movement.rightward
      if (movement.joystick) joystickState.current.set(movement.joystick.x, movement.joystick.y)
      if (movement.run !== undefined) runState.current = movement.run
      if (movement.jump !== undefined) jumpState.current = movement.jump
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        get group() {
          return characterGroupRef.current
        },
        get model() {
          return characterModelRef.current
        },
        resetLinVel,
        addLinVel,
        setLinVel,
        setMovement,
      }),
      [addLinVel, resetLinVel, setLinVel, setMovement],
    )

    const updateDebugger = useCallback(() => {
      debugLineStart.current?.position.copy(characterSegment.current.start)
      debugLineEnd.current?.position.copy(characterSegment.current.end)
      debugRaySensorStart.current?.position.copy(floatSensorSegment.current.start)
      debugRaySensorEnd.current?.position.copy(floatSensorSegment.current.end)
      standPointRef.current?.position.copy(globalClosestPoint.current)
      if (characterGroupRef.current) {
        lookDirRef.current?.position.copy(characterGroupRef.current.position).addScaledVector(upAxis.current, 0.7)
      }
      lookDirRef.current?.lookAt(lookDirRef.current.position.clone().add(camProjDir.current))
      inputDirRef.current?.position.copy(characterSegment.current.end)
      inputDirRef.current?.setDirection(inputDir.current)
      inputDirRef.current?.setLength(inputDir.current.lengthSq())
      moveDirRef.current?.position.copy(characterSegment.current.end)
      moveDirRef.current?.setDirection(currentLinVel.current)
      moveDirRef.current?.setLength(currentLinVel.current.length() / maxWalkSpeed)
    }, [characterSegment, maxWalkSpeed])

    useFrame((_, delta) => {
      elapsedRef.current += delta
      if (paused || elapsedRef.current < delay) return

      const deltaTime = Math.min(1 / 45, delta) * slowMotionFactor
      const keys = isInsideKeyboardControls && getKeys ? getKeys() : presetKeys
      const forward = forwardState.current || keys.forward
      const backward = backwardState.current || keys.backward
      const leftward = leftwardState.current || keys.leftward
      const rightward = rightwardState.current || keys.rightward
      const run = runState.current || keys.run
      const jump = jumpState.current || keys.jump

      setInputDirection({
        forward,
        backward,
        leftward,
        rightward,
        joystick: joystickState.current,
      })
      handleCharacterMovement(run, deltaTime)
      if (jump && isOnGround.current) currentLinVel.current.y = jumpVel
      movingDir.current.copy(currentLinVel.current).normalize()
      currentLinVelOnPlane.current.copy(currentLinVel.current).projectOnPlane(upAxis.current)

      checkCharacterSleep(jump, deltaTime)
      if (!isSleeping.current) {
        if (!isOnGround.current) applyGravity(deltaTime)

        updateSegmentBBox()
        handleCollisionResponse(colliderMeshes, deltaTime)
        handleFloatingResponse(colliderMeshes, jump, deltaTime)
        updateCharacterWithPlatform()

        if (characterGroupRef.current) {
          characterGroupRef.current.position.addScaledVector(currentLinVel.current, deltaTime)
        }

        updateCharacterStatus(run, jump)
        prevIsOnGround.current = isOnGround.current
      }

      if (debug) updateDebugger()
    })

    return (
      <Suspense fallback={null}>
        <group {...props} ref={characterGroupRef} dispose={null}>
          {debug && (
            <mesh ref={characterColliderRef}>
              <capsuleGeometry args={colliderCapsuleArgs} />
              <meshNormalMaterial wireframe />
            </mesh>
          )}
          <group name="BVHEcctrl-Model" ref={characterModelRef}>
            {children}
          </group>
        </group>

        {debug && (
          <group>
            <TransformControls object={characterGroupRef.current!} />
            <box3Helper args={[characterBbox.current]} />
            <mesh ref={debugLineStart}>
              <octahedronGeometry args={[0.05, 0]} />
              <meshNormalMaterial />
            </mesh>
            <mesh ref={debugLineEnd}>
              <octahedronGeometry args={[0.05, 0]} />
              <meshNormalMaterial />
            </mesh>
            <box3Helper args={[floatSensorBbox.current]} />
            <mesh ref={debugRaySensorStart}>
              <octahedronGeometry args={[0.1, 0]} />
              <meshBasicMaterial color="yellow" wireframe />
            </mesh>
            <mesh ref={debugRaySensorEnd}>
              <octahedronGeometry args={[0.1, 0]} />
              <meshBasicMaterial color="yellow" wireframe />
            </mesh>
            <mesh ref={lookDirRef} scale={[1, 0.5, 4]}>
              <octahedronGeometry args={[0.1, 0]} />
              <meshNormalMaterial />
            </mesh>
            <arrowHelper ref={inputDirRef} args={[undefined, undefined, undefined, '#00f']} />
            <arrowHelper ref={moveDirRef} args={[undefined, undefined, undefined, '#f00']} />
            <mesh ref={standPointRef}>
              <octahedronGeometry args={[0.12, 0]} />
              <meshBasicMaterial color="red" opacity={0.2} transparent />
            </mesh>
          </group>
        )}
      </Suspense>
    )
  },
)

BVHEcctrl.displayName = 'BVHEcctrl'

export default BVHEcctrl
