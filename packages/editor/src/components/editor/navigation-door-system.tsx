'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { type MutableRefObject, useEffect, useMemo, useRef } from 'react'
import { Box3, type Curve, Euler, MathUtils, Matrix4, type Object3D, Vector2, Vector3 } from 'three'
import {
  getNavigationDoorTransitions,
  type NavigationDoorTransition,
  type NavigationGraph,
  type NavigationPathResult,
} from '../../lib/navigation'
import {
  measureNavigationPerf,
  mergeNavigationPerfMeta,
  recordNavigationPerfSample,
} from '../../lib/navigation-performance'

const DOOR_APPROACH_OPEN_DISTANCE = 1.15
const DOOR_EXIT_CLOSE_DISTANCE = 1.65
const DOOR_SWING_RESPONSE = 10
const DOOR_OVERHEAD_APPROACH_OPEN_DISTANCE = DOOR_APPROACH_OPEN_DISTANCE * 2
const DOOR_OVERHEAD_EXIT_CLOSE_DISTANCE = DOOR_EXIT_CLOSE_DISTANCE * 2
const DOOR_OVERHEAD_OPEN_RESPONSE = 4
const DOOR_OVERHEAD_CLOSE_RESPONSE = DOOR_OVERHEAD_OPEN_RESPONSE / 2
const DOOR_ROTATION_SETTLE_EPSILON = MathUtils.degToRad(1)
const DOOR_POSITION_SETTLE_EPSILON = 0.01
const ITEM_DOOR_OPEN_ANGLE = MathUtils.degToRad(170)
const DOOR_SWING_TARGET_OPEN_FRACTION = 0.86
const DOOR_OVERHEAD_TARGET_OPEN_FRACTION = 0.72
const DOOR_OPEN_LEAD_PADDING_SECONDS = 0.18
const DOOR_OVERHEAD_OPEN_LEAD_PADDING_SECONDS = 0.22
const DOOR_CLOSE_PADDING_SECONDS = 0.18
const DOOR_TRIGGER_REFERENCE_SPEED = 1.4
const DOOR_TRIGGER_MAX_SPEED = 3.6
const activeNavigationDoorIds = new Set<string>()

type DoorAnimationState = {
  alternateOpenPosition?: [number, number, number]
  alternateOpenRotation?: [number, number, number]
  closedPosition?: [number, number, number]
  closedRotation?: [number, number, number]
  localBounds?: {
    max: [number, number, number]
    min: [number, number, number]
  }
  openPosition?: [number, number, number]
  openRotation?: [number, number, number]
  style?: 'overhead' | 'swing'
}

type MotionStateRef = MutableRefObject<{
  destinationCellIndex: number | null
  distance: number
  moving: boolean
  speed: number
}>

type NavigationDoorSystemProps = {
  enabled: boolean
  graph: NavigationGraph
  motionRef: MotionStateRef
  motionCurve: Curve<Vector3> | null
  pathIndices: NavigationPathResult['indices']
  pathLength: number
}

export function getActiveNavigationDoorIds() {
  return activeNavigationDoorIds
}

type DoorOpenTarget = {
  desiredWorldSide: Vector2
  openingId: string
  openingWorld: [number, number, number]
}

type DoorOpenTargetSelection = {
  openingId: string
  projection: number | null
  variant: 'alternate' | 'primary'
}

function getObjectBoundsInParentSpace(object: Object3D, parent: Object3D) {
  object.updateWorldMatrix(true, true)
  parent.updateWorldMatrix(true, true)

  const inverseParentMatrix = new Matrix4().copy(parent.matrixWorld).invert()
  const bounds = new Box3()
  let initialized = false

  object.traverse((child) => {
    if (
      !('geometry' in child) ||
      !(child as { geometry?: { boundingBox?: Box3 | null } }).geometry
    ) {
      return
    }

    const mesh = child as Object3D & {
      geometry: { boundingBox?: Box3 | null; computeBoundingBox: () => void }
      matrixWorld: Matrix4
    }
    mesh.geometry.computeBoundingBox()
    const childBounds = mesh.geometry.boundingBox?.clone()
    if (!childBounds) {
      return
    }

    const childMatrixInParentSpace = new Matrix4().multiplyMatrices(
      inverseParentMatrix,
      mesh.matrixWorld,
    )
    childBounds.applyMatrix4(childMatrixInParentSpace)

    if (initialized) {
      bounds.union(childBounds)
    } else {
      bounds.copy(childBounds)
      initialized = true
    }
  })

  return initialized ? bounds : null
}

function ensureItemDoorAnimationState(doorId: string) {
  const doorRoot = sceneRegistry.nodes.get(doorId)
  const leafPivot = doorRoot?.getObjectByName('door-leaf-pivot')
  const currentAnimationState = leafPivot?.userData.navigationDoor as DoorAnimationState | undefined

  if (!sceneRegistry.byType.item.has(doorId) || !(doorRoot && leafPivot)) {
    return {
      animationState: currentAnimationState,
      doorRoot,
      leafPivot,
    }
  }

  if (currentAnimationState?.localBounds) {
    return {
      animationState: currentAnimationState,
      doorRoot,
      leafPivot,
    }
  }

  const leafGroup = leafPivot.getObjectByName('door-leaf-group')
  if (!leafGroup) {
    return {
      animationState: currentAnimationState,
      doorRoot,
      leafPivot,
    }
  }

  const hingeHint = leafPivot.getObjectByName('door-leaf-hinge-hint')
  const initialBounds = getObjectBoundsInParentSpace(leafGroup, leafPivot)
  if (!initialBounds) {
    return {
      animationState: currentAnimationState,
      doorRoot,
      leafPivot,
    }
  }

  const hingeX =
    hingeHint?.position.x ??
    (Math.abs(initialBounds.min.x) <= Math.abs(initialBounds.max.x)
      ? initialBounds.min.x
      : initialBounds.max.x)

  leafPivot.position.set(hingeX, 0, 0)
  leafPivot.rotation.set(0, 0, 0)
  leafGroup.position.set(-hingeX, 0, 0)
  leafGroup.rotation.set(0, 0, 0)

  const localBounds = getObjectBoundsInParentSpace(leafGroup, leafPivot) ?? initialBounds
  const animationState: DoorAnimationState = {
    alternateOpenPosition: [hingeX, 0, 0],
    alternateOpenRotation: [0, -ITEM_DOOR_OPEN_ANGLE, 0],
    closedPosition: [hingeX, 0, 0],
    closedRotation: [0, 0, 0],
    localBounds: {
      max: [localBounds.max.x, localBounds.max.y, localBounds.max.z],
      min: [localBounds.min.x, localBounds.min.y, localBounds.min.z],
    },
    openPosition: [hingeX, 0, 0],
    openRotation: [0, ITEM_DOOR_OPEN_ANGLE, 0],
    style: 'swing',
  }
  leafPivot.userData.navigationDoor = animationState

  return {
    animationState,
    doorRoot,
    leafPivot,
  }
}

function getDoorAnimationState(doorId: string) {
  if (sceneRegistry.byType.item.has(doorId)) {
    return ensureItemDoorAnimationState(doorId)
  }

  const doorRoot = sceneRegistry.nodes.get(doorId)
  const leafPivot = doorRoot?.getObjectByName('door-leaf-pivot')
  const animationState = leafPivot?.userData.navigationDoor as DoorAnimationState | undefined

  return {
    animationState,
    doorRoot,
    leafPivot,
  }
}

function getDoorAnimationDelta(doorId: string) {
  const { animationState, leafPivot } = getDoorAnimationState(doorId)
  if (!leafPivot) {
    return 0
  }

  const closedRotation = animationState?.closedRotation ?? [0, 0, 0]
  const closedPosition = animationState?.closedPosition ?? [
    leafPivot.position.x,
    leafPivot.position.y,
    leafPivot.position.z,
  ]

  return Math.max(
    Math.abs(leafPivot.rotation.x - closedRotation[0]!),
    Math.abs(leafPivot.rotation.y - closedRotation[1]!),
    Math.abs(leafPivot.rotation.z - closedRotation[2]!),
    Math.abs(leafPivot.position.x - closedPosition[0]!),
    Math.abs(leafPivot.position.y - closedPosition[1]!),
    Math.abs(leafPivot.position.z - closedPosition[2]!),
  )
}

function getDoorDesiredOpenTarget(doorTrigger: NavigationDoorTransition): DoorOpenTarget | null {
  const preferredSide = new Vector2(
    doorTrigger.departureWorld[0] - doorTrigger.world[0],
    doorTrigger.departureWorld[2] - doorTrigger.world[2],
  )

  if (preferredSide.lengthSq() <= Number.EPSILON) {
    preferredSide.set(
      doorTrigger.exitWorld[0] - doorTrigger.world[0],
      doorTrigger.exitWorld[2] - doorTrigger.world[2],
    )
  }

  if (preferredSide.lengthSq() <= Number.EPSILON) {
    return null
  }

  preferredSide.normalize()
  return {
    desiredWorldSide: preferredSide,
    openingId: doorTrigger.openingId,
    openingWorld: doorTrigger.world,
  }
}

function getDoorLeafCentroidWorld(
  leafPivot: Object3D,
  animationState: DoorAnimationState,
  rotation: [number, number, number],
  position: [number, number, number],
) {
  const parent = leafPivot.parent
  if (!parent) {
    return null
  }

  const localBounds = animationState.localBounds
  const localCenter = localBounds
    ? new Vector3(
        (localBounds.min[0] + localBounds.max[0]) / 2,
        (localBounds.min[1] + localBounds.max[1]) / 2,
        (localBounds.min[2] + localBounds.max[2]) / 2,
      )
    : new Vector3()

  const localPoint = localCenter
    .clone()
    .applyEuler(new Euler(rotation[0], rotation[1], rotation[2], 'XYZ'))
    .add(new Vector3(position[0], position[1], position[2]))

  return parent.localToWorld(localPoint)
}

function getPreferredSwingDoorTarget(
  leafPivot: Object3D,
  animationState: DoorAnimationState,
  openTarget: DoorOpenTarget | null,
) {
  const closedRotation = animationState.closedRotation ?? [0, 0, 0]
  const closedPosition = animationState.closedPosition ?? [
    leafPivot.position.x,
    leafPivot.position.y,
    leafPivot.position.z,
  ]
  const primaryRotation = animationState.openRotation ?? closedRotation
  const primaryPosition = animationState.openPosition ?? closedPosition
  const alternateRotation = animationState.alternateOpenRotation
  const alternatePosition = animationState.alternateOpenPosition

  if (
    animationState.style !== 'swing' ||
    !openTarget ||
    !(alternateRotation && alternatePosition)
  ) {
    return {
      projection: null,
      targetPosition: primaryPosition,
      targetRotation: primaryRotation,
      variant: 'primary' as const,
    }
  }

  const primaryCentroid = getDoorLeafCentroidWorld(
    leafPivot,
    animationState,
    primaryRotation,
    primaryPosition,
  )
  const alternateCentroid = getDoorLeafCentroidWorld(
    leafPivot,
    animationState,
    alternateRotation,
    alternatePosition,
  )

  if (!(primaryCentroid && alternateCentroid)) {
    return {
      projection: null,
      targetPosition: primaryPosition,
      targetRotation: primaryRotation,
      variant: 'primary' as const,
    }
  }

  const projectSide = (centroid: Vector3) =>
    (centroid.x - openTarget.openingWorld[0]) * openTarget.desiredWorldSide.x +
    (centroid.z - openTarget.openingWorld[2]) * openTarget.desiredWorldSide.y

  const primaryScore = projectSide(primaryCentroid)
  const alternateScore = projectSide(alternateCentroid)

  if (alternateScore > primaryScore) {
    return {
      projection: alternateScore,
      targetPosition: alternatePosition,
      targetRotation: alternateRotation,
      variant: 'alternate' as const,
    }
  }

  return {
    projection: primaryScore,
    targetPosition: primaryPosition,
    targetRotation: primaryRotation,
    variant: 'primary' as const,
  }
}

function getDoorTriggerWindowDistances(doorIds: string[], currentSpeed: number) {
  let isOverheadDoor = false
  for (const doorId of doorIds) {
    const { animationState } = getDoorAnimationState(doorId)
    if (animationState?.style === 'overhead') {
      isOverheadDoor = true
      break
    }
  }

  const baseApproachDistance = isOverheadDoor
    ? DOOR_OVERHEAD_APPROACH_OPEN_DISTANCE
    : DOOR_APPROACH_OPEN_DISTANCE
  const baseCloseDistance = isOverheadDoor
    ? DOOR_OVERHEAD_EXIT_CLOSE_DISTANCE
    : DOOR_EXIT_CLOSE_DISTANCE
  const response = isOverheadDoor ? DOOR_OVERHEAD_OPEN_RESPONSE : DOOR_SWING_RESPONSE
  const targetOpenFraction = isOverheadDoor
    ? DOOR_OVERHEAD_TARGET_OPEN_FRACTION
    : DOOR_SWING_TARGET_OPEN_FRACTION
  const leadPaddingSeconds = isOverheadDoor
    ? DOOR_OVERHEAD_OPEN_LEAD_PADDING_SECONDS
    : DOOR_OPEN_LEAD_PADDING_SECONDS
  const anticipatedSpeed = MathUtils.clamp(
    Math.max(currentSpeed, DOOR_TRIGGER_REFERENCE_SPEED),
    0,
    DOOR_TRIGGER_MAX_SPEED,
  )
  const normalizedUnopenedFraction = Math.max(1 - targetOpenFraction, 1e-3)
  const responseLeadSeconds = -Math.log(normalizedUnopenedFraction) / Math.max(response, 1e-3)
  const approachDistance = Math.max(
    baseApproachDistance,
    anticipatedSpeed * (responseLeadSeconds + leadPaddingSeconds) + 0.45,
  )
  const closeDistance = Math.max(
    baseCloseDistance,
    anticipatedSpeed * DOOR_CLOSE_PADDING_SECONDS + 0.35,
  )

  return {
    approachDistance,
    closeDistance,
  }
}

function getInitialOverheadDoorOpenAmount(
  leafPivot: Object3D,
  closedRotation: [number, number, number],
  openRotation: [number, number, number],
  closedPosition: [number, number, number],
  openPosition: [number, number, number],
) {
  const progressCandidates = [
    Math.abs(openRotation[0] - closedRotation[0]) > Number.EPSILON
      ? (leafPivot.rotation.x - closedRotation[0]) / (openRotation[0] - closedRotation[0])
      : null,
    Math.abs(openRotation[1] - closedRotation[1]) > Number.EPSILON
      ? (leafPivot.rotation.y - closedRotation[1]) / (openRotation[1] - closedRotation[1])
      : null,
    Math.abs(openRotation[2] - closedRotation[2]) > Number.EPSILON
      ? (leafPivot.rotation.z - closedRotation[2]) / (openRotation[2] - closedRotation[2])
      : null,
    Math.abs(openPosition[0] - closedPosition[0]) > Number.EPSILON
      ? (leafPivot.position.x - closedPosition[0]) / (openPosition[0] - closedPosition[0])
      : null,
    Math.abs(openPosition[1] - closedPosition[1]) > Number.EPSILON
      ? (leafPivot.position.y - closedPosition[1]) / (openPosition[1] - closedPosition[1])
      : null,
    Math.abs(openPosition[2] - closedPosition[2]) > Number.EPSILON
      ? (leafPivot.position.z - closedPosition[2]) / (openPosition[2] - closedPosition[2])
      : null,
  ].filter((value): value is number => value !== null && Number.isFinite(value))

  if (progressCandidates.length === 0) {
    return 0
  }

  const averageProgress =
    progressCandidates.reduce((sum, value) => sum + value, 0) / progressCandidates.length

  return MathUtils.clamp(averageProgress, 0, 1)
}

function getInterpolatedDoorTransform(
  closedRotation: [number, number, number],
  openRotation: [number, number, number],
  closedPosition: [number, number, number],
  openPosition: [number, number, number],
  openAmount: number,
) {
  const clampedOpenAmount = MathUtils.clamp(openAmount, 0, 1)

  return {
    position: [
      MathUtils.lerp(closedPosition[0]!, openPosition[0]!, clampedOpenAmount),
      MathUtils.lerp(closedPosition[1]!, openPosition[1]!, clampedOpenAmount),
      MathUtils.lerp(closedPosition[2]!, openPosition[2]!, clampedOpenAmount),
    ] as [number, number, number],
    rotation: [
      MathUtils.lerp(closedRotation[0]!, openRotation[0]!, clampedOpenAmount),
      MathUtils.lerp(closedRotation[1]!, openRotation[1]!, clampedOpenAmount),
      MathUtils.lerp(closedRotation[2]!, openRotation[2]!, clampedOpenAmount),
    ] as [number, number, number],
  }
}

export function NavigationDoorSystem({
  enabled,
  graph,
  motionRef,
  motionCurve,
  pathIndices,
  pathLength,
}: NavigationDoorSystemProps) {
  const trackedDoorIdsRef = useRef(new Set<string>())
  const doorOpenSelectionsRef = useRef(new Map<string, DoorOpenTargetSelection>())
  const overheadDoorOpenAmountsRef = useRef(new Map<string, number>())
  const previewDoorOpenAmountsRef = useRef(new Map<string, number>())
  const doorTriggers = useMemo(
    () =>
      measureNavigationPerf('navigation.doorTriggerBuildMs', () =>
        getNavigationDoorTransitions(graph, pathIndices),
      ),
    [graph, pathIndices],
  )
  const doorTriggerDistances = useMemo(
    () =>
      measureNavigationPerf('navigation.doorTriggerDistanceBuildMs', () => {
        if (!(motionCurve && pathLength > Number.EPSILON && doorTriggers.length > 0)) {
          return []
        }

        const sampleCount = Math.max(128, Math.ceil(pathLength / 0.06))
        const sampledPoint = new Vector3()
        const triggerPoint = new Vector3()

        return doorTriggers.map((doorTrigger) => {
          let bestDistanceAlongCurve = 0
          let bestDistanceSq = Number.POSITIVE_INFINITY
          triggerPoint.set(doorTrigger.world[0], doorTrigger.world[1], doorTrigger.world[2])

          for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
            const sampleProgress = sampleIndex / sampleCount
            motionCurve.getPointAt(sampleProgress, sampledPoint)
            const distanceSq = sampledPoint.distanceToSquared(triggerPoint)
            if (distanceSq < bestDistanceSq) {
              bestDistanceSq = distanceSq
              bestDistanceAlongCurve = sampleProgress * pathLength
            }
          }

          return {
            doorTrigger,
            triggerDistance: bestDistanceAlongCurve,
          }
        })
      }),
    [doorTriggers, motionCurve, pathLength],
  )

  useEffect(() => {
    mergeNavigationPerfMeta({
      navigationDoorTriggerCount: doorTriggers.length,
    })
  }, [doorTriggers.length])

  useFrame((_, delta) => {
    const frameStart = performance.now()
    const currentDistance =
      enabled && pathLength > Number.EPSILON
        ? MathUtils.clamp(motionRef.current.distance, 0, pathLength)
        : null
    const openDoorIds = new Set<string>()
    const openTargetsByDoorId = new Map<string, DoorOpenTarget>()

    if (currentDistance !== null) {
      for (const { doorTrigger, triggerDistance } of doorTriggerDistances) {
        const { approachDistance, closeDistance } = getDoorTriggerWindowDistances(
          doorTrigger.doorIds,
          motionRef.current.speed,
        )

        if (
          currentDistance >= triggerDistance - approachDistance &&
          currentDistance <= triggerDistance + closeDistance
        ) {
          const openTarget = getDoorDesiredOpenTarget(doorTrigger)
          for (const doorId of doorTrigger.doorIds) {
            openDoorIds.add(doorId)
            if (openTarget) {
              openTargetsByDoorId.set(doorId, openTarget)
            }
          }
        }
      }
    }

    const activeDoorIds = new Set<string>([...trackedDoorIdsRef.current, ...openDoorIds])
    activeNavigationDoorIds.clear()
    for (const doorId of activeDoorIds) {
      activeNavigationDoorIds.add(doorId)
    }
    let openDoorCount = 0

    for (const doorId of activeDoorIds) {
      const { animationState, leafPivot } = getDoorAnimationState(doorId)
      if (!leafPivot) {
        trackedDoorIdsRef.current.delete(doorId)
        overheadDoorOpenAmountsRef.current.delete(doorId)
        continue
      }

      const closedRotation = animationState?.closedRotation ?? [0, 0, 0]
      const openRotation = animationState?.openRotation ?? closedRotation
      const closedPosition = animationState?.closedPosition ?? [
        leafPivot.position.x,
        leafPivot.position.y,
        leafPivot.position.z,
      ]
      const openPosition = animationState?.openPosition ?? closedPosition
      const preferredOpenTarget = getPreferredSwingDoorTarget(
        leafPivot,
        animationState ?? {},
        openTargetsByDoorId.get(doorId) ?? null,
      )
      const isOverheadDoor = animationState?.style === 'overhead'
      const previewOpenAmount = previewDoorOpenAmountsRef.current.get(doorId)
      let targetRotation = openDoorIds.has(doorId)
        ? preferredOpenTarget.targetRotation
        : closedRotation
      let targetPosition = openDoorIds.has(doorId)
        ? preferredOpenTarget.targetPosition
        : closedPosition

      if (openDoorIds.has(doorId)) {
        const openTarget = openTargetsByDoorId.get(doorId)
        if (openTarget) {
          doorOpenSelectionsRef.current.set(doorId, {
            openingId: openTarget.openingId,
            projection: preferredOpenTarget.projection,
            variant: preferredOpenTarget.variant,
          })
        }
      } else {
        doorOpenSelectionsRef.current.delete(doorId)
      }

      if (typeof previewOpenAmount === 'number') {
        const previewTransform = getInterpolatedDoorTransform(
          closedRotation,
          openRotation,
          closedPosition,
          openPosition,
          previewOpenAmount,
        )
        leafPivot.rotation.set(...previewTransform.rotation)
        leafPivot.position.set(...previewTransform.position)
        trackedDoorIdsRef.current.add(doorId)
      } else if (isOverheadDoor) {
        const targetOpenAmount = openDoorIds.has(doorId) ? 1 : 0
        const currentOpenAmount =
          overheadDoorOpenAmountsRef.current.get(doorId) ??
          getInitialOverheadDoorOpenAmount(
            leafPivot,
            closedRotation,
            openRotation,
            closedPosition,
            openPosition,
          )
        const overheadResponse =
          targetOpenAmount < currentOpenAmount
            ? DOOR_OVERHEAD_CLOSE_RESPONSE
            : DOOR_OVERHEAD_OPEN_RESPONSE
        const nextOpenAmount = MathUtils.damp(
          currentOpenAmount,
          targetOpenAmount,
          overheadResponse,
          delta,
        )
        overheadDoorOpenAmountsRef.current.set(doorId, nextOpenAmount)

        const overheadTransform = getInterpolatedDoorTransform(
          closedRotation,
          openRotation,
          closedPosition,
          openPosition,
          nextOpenAmount,
        )
        targetRotation = overheadTransform.rotation
        targetPosition = overheadTransform.position

        leafPivot.rotation.set(...targetRotation)
        leafPivot.position.set(...targetPosition)
      } else {
        overheadDoorOpenAmountsRef.current.delete(doorId)

        leafPivot.rotation.x = MathUtils.damp(
          leafPivot.rotation.x,
          targetRotation[0]!,
          DOOR_SWING_RESPONSE,
          delta,
        )
        leafPivot.rotation.y = MathUtils.damp(
          leafPivot.rotation.y,
          targetRotation[1]!,
          DOOR_SWING_RESPONSE,
          delta,
        )
        leafPivot.rotation.z = MathUtils.damp(
          leafPivot.rotation.z,
          targetRotation[2]!,
          DOOR_SWING_RESPONSE,
          delta,
        )
        leafPivot.position.x = MathUtils.damp(
          leafPivot.position.x,
          targetPosition[0]!,
          DOOR_SWING_RESPONSE,
          delta,
        )
        leafPivot.position.y = MathUtils.damp(
          leafPivot.position.y,
          targetPosition[1]!,
          DOOR_SWING_RESPONSE,
          delta,
        )
        leafPivot.position.z = MathUtils.damp(
          leafPivot.position.z,
          targetPosition[2]!,
          DOOR_SWING_RESPONSE,
          delta,
        )
      }

      const rotationDelta = Math.max(
        Math.abs(leafPivot.rotation.x - closedRotation[0]!),
        Math.abs(leafPivot.rotation.y - closedRotation[1]!),
        Math.abs(leafPivot.rotation.z - closedRotation[2]!),
      )
      const positionDelta = Math.max(
        Math.abs(leafPivot.position.x - closedPosition[0]!),
        Math.abs(leafPivot.position.y - closedPosition[1]!),
        Math.abs(leafPivot.position.z - closedPosition[2]!),
      )
      const isStillAnimating =
        openDoorIds.has(doorId) ||
        rotationDelta > DOOR_ROTATION_SETTLE_EPSILON ||
        positionDelta > DOOR_POSITION_SETTLE_EPSILON

      if (isStillAnimating) {
        trackedDoorIdsRef.current.add(doorId)
      } else {
        leafPivot.rotation.set(...closedRotation)
        leafPivot.position.set(...closedPosition)
        trackedDoorIdsRef.current.delete(doorId)
        doorOpenSelectionsRef.current.delete(doorId)
        overheadDoorOpenAmountsRef.current.delete(doorId)
        previewDoorOpenAmountsRef.current.delete(doorId)
      }

      if (
        rotationDelta > MathUtils.degToRad(8) ||
        positionDelta > DOOR_POSITION_SETTLE_EPSILON * 2
      ) {
        openDoorCount += 1
      }
    }

    mergeNavigationPerfMeta({
      navigationDoorActiveCount: openDoorCount,
    })
    recordNavigationPerfSample('navigation.doorsFrameMs', performance.now() - frameStart)
  })

  useEffect(() => {
    return () => {
      activeNavigationDoorIds.clear()
    }
  }, [])

  return null
}
