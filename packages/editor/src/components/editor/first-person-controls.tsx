'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ElevatorDoorSide,
  type ElevatorNode,
  emitter,
  getElevatorCabCenterZ,
  getElevatorCabDepth,
  getElevatorCabWidth,
  getElevatorDoorLeafSides,
  getElevatorDoorLeafWidth,
  getElevatorDoorLeafX,
  getElevatorShaftDepth,
  getElevatorShaftWallThickness,
  getElevatorShaftWidth,
  getResolvedElevatorDoorStyle,
  openElevatorDoor,
  requestElevatorLevel,
  resolveElevatorBuildingLevels,
  resolveElevatorDispatchTarget,
  resolveElevatorServiceLevels,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { KeyboardControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box3,
  BoxGeometry,
  Euler,
  type Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Ray,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import '../../three-types'
import { BVHEcctrl, type BVHEcctrlApi, type MovementInput } from '@pascal-app/viewer'
import {
  closeDoorOpenState,
  DOOR_SWING_OPEN_ANGLE,
  isOperationDoorType,
  toggleDoorOpenState,
} from '../../lib/door-interaction'
import {
  closeWindowOpenState,
  isOperableWindowType,
  toggleWindowOpenState,
} from '../../lib/window-interaction'
import useEditor from '../../store/use-editor'
import {
  buildFirstPersonColliderWorldFromRegistry,
  deriveFirstPersonSpawn,
  FIRST_PERSON_SPAWN_EYE_HEIGHT,
  type FirstPersonColliderWorld,
  type FirstPersonSpawn,
} from './first-person/build-collider-world'

const CAMERA_EYE_OFFSET = 0.45
const LOOK_SENSITIVITY = 0.002
const CONTROLLER_CENTER_FROM_EYE = 0.85
const DOOR_INTERACTION_DISTANCE = 2.5
const DOOR_LEAF_INTERACTION_DEPTH = 0.08
const ELEVATOR_RIDE_HORIZONTAL_PADDING = 0.18
const ELEVATOR_COLLIDER_HORIZONTAL_PADDING = 0.14
const ELEVATOR_COLLIDER_FLOOR_THICKNESS = 0.08
const ELEVATOR_COLLIDER_DOOR_DEPTH = 0.12
const ELEVATOR_ENTRY_DOOR_OPEN_THRESHOLD = 0.72
const DEFAULT_ELEVATOR_LEVEL_HEIGHT = 2.5
const VOID_FALL_RESPAWN_DEPTH = 12

type MovementKeyName = Exclude<keyof MovementInput, 'joystick'>

const movementKeyboardBindings: Array<{ name: MovementKeyName; keys: string[] }> = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
]
const keyboardMap = movementKeyboardBindings
const movementKeyToName = new Map<string, MovementKeyName>(
  movementKeyboardBindings.flatMap(({ name, keys }) => keys.map((key) => [key, name] as const)),
)

const inactiveMovementInput: MovementInput = {
  backward: false,
  forward: false,
  jump: false,
  leftward: false,
  rightward: false,
  run: false,
}

function getMovementInputForKey(code: string, active: boolean): MovementInput | null {
  const name = movementKeyToName.get(code)
  return name ? ({ [name]: active } as MovementInput) : null
}

function focusFirstPersonCanvas(canvas: HTMLCanvasElement) {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && !canvas.contains(activeElement)) {
    activeElement.blur()
  }

  if (!canvas.hasAttribute('tabindex')) {
    canvas.tabIndex = -1
  }
  canvas.focus({ preventScroll: true })
}

const cameraOffset = new Vector3(0, CAMERA_EYE_OFFSET, 0)
const cameraEuler = new Euler(0, 0, 0, 'YXZ')
const centerScreenPoint = new Vector2(0, 0)
const doorInteractionRaycaster = new Raycaster()
const doorLeafBox = new Box3()
const doorLeafInverseMatrix = new Matrix4()
const doorLeafLocalHit = new Vector3()
const doorLeafLocalRay = new Ray()
const doorLeafMatrix = new Matrix4()
const doorLeafWorldHit = new Vector3()
const doorOpeningBox = new Box3()
const doorOpeningInverseMatrix = new Matrix4()
const doorOpeningLocalHit = new Vector3()
const doorOpeningLocalRay = new Ray()
const doorOpeningMatrix = new Matrix4()
const doorOpeningWorldHit = new Vector3()
const elevatorLocalControllerPosition = new Vector3()
const elevatorInteractionRaycaster = new Raycaster()
const elevatorColliderMatrix = new Matrix4()
const elevatorColliderLocalMatrix = new Matrix4()
const elevatorLocalEyePosition = new Vector3()
const elevatorWorldControllerPosition = new Vector3()
const elevatorColliderMaterial = new MeshBasicMaterial({ visible: false })
const spawnWorldPosition = new Vector3()
const spawnWorldEuler = new Euler(0, 0, 0, 'YXZ')
const windowInteractionRaycaster = new Raycaster()

type ElevatorColliderKind =
  | 'cab-back'
  | 'cab-ceiling'
  | 'cab-door-left'
  | 'cab-door-right'
  | 'cab-door-gate'
  | 'cab-floor'
  | 'cab-left'
  | 'cab-right'
  | 'landing-door-gate'
  | 'landing-door-left'
  | 'landing-door-right'
  | 'shaft-back'
  | 'shaft-front-header'
  | 'shaft-front-left'
  | 'shaft-front-right'
  | 'shaft-left'
  | 'shaft-right'
  | 'shaft-top'

type ElevatorColliderUserData = {
  doorWidth?: number
  dynamic?: boolean
  elevatorId: AnyNodeId
  kind: ElevatorColliderKind
  levelId?: AnyNodeId
  localPosition: [number, number, number]
  matrixInitialized?: boolean
  side?: ElevatorDoorSide
}

type ElevatorColliderMesh = Mesh & {
  userData: Mesh['userData'] & ElevatorColliderUserData
}

type FirstPersonInteractableTarget =
  | {
      id: AnyNodeId
      type: 'door' | 'window'
    }
  | {
      action: 'open-door' | 'request-level'
      buttonKind: 'cab' | 'landing'
      id: AnyNodeId
      levelId?: AnyNodeId
      type: 'elevator'
    }

type ElevatorButtonTarget = {
  action: 'open-door' | 'request-level'
  buttonKind: 'cab' | 'landing'
  elevatorId: AnyNodeId
  levelId?: AnyNodeId
}

function resolveElevatorButtonTarget(object: Object3D): ElevatorButtonTarget | null {
  let current: Object3D | null = object

  while (current) {
    const candidate = (
      current.userData as {
        elevatorButton?: {
          action?: unknown
          disabled?: unknown
          elevatorId?: unknown
          kind?: unknown
          levelId?: unknown
        }
      }
    ).elevatorButton

    if (candidate?.disabled === true) {
      return null
    }

    if (typeof candidate?.elevatorId === 'string' && candidate.kind === 'cab') {
      const action = candidate.action === 'open-door' ? 'open-door' : 'request-level'
      if (action === 'open-door') {
        return {
          action,
          buttonKind: candidate.kind,
          elevatorId: candidate.elevatorId as AnyNodeId,
        }
      }
    }

    if (
      typeof candidate?.elevatorId === 'string' &&
      typeof candidate.levelId === 'string' &&
      (candidate.kind === 'cab' || candidate.kind === 'landing')
    ) {
      return {
        action: 'request-level',
        buttonKind: candidate.kind,
        elevatorId: candidate.elevatorId as AnyNodeId,
        levelId: candidate.levelId as AnyNodeId,
      }
    }

    current = current.parent
  }

  return null
}

function getInteractableTargetKey(target: FirstPersonInteractableTarget | null) {
  if (!target) return null
  return target.type === 'elevator'
    ? `${target.type}:${target.id}:${target.levelId}`
    : `${target.type}:${target.id}`
}

function isDynamicElevatorCollider(kind: ElevatorColliderKind) {
  return kind.startsWith('cab-') || kind.startsWith('landing-door')
}

function isInsideElevatorCab(
  elevator: ElevatorNode,
  runtime: NonNullable<ReturnType<typeof useInteractive.getState>['elevators'][AnyNodeId]>,
  localEyePosition: Vector3,
) {
  const halfWidth = getElevatorCabWidth(elevator) / 2 - ELEVATOR_RIDE_HORIZONTAL_PADDING
  const halfDepth = getElevatorCabDepth(elevator) / 2 - ELEVATOR_RIDE_HORIZONTAL_PADDING
  const cabCenterZ = getElevatorCabCenterZ(elevator)
  const cabHeight = Math.max(elevator.cabHeight, 1.4)

  return (
    Math.abs(localEyePosition.x) <= Math.max(halfWidth, 0.24) &&
    Math.abs(localEyePosition.z - cabCenterZ) <= Math.max(halfDepth, 0.24) &&
    localEyePosition.y >= runtime.carY + 0.35 &&
    localEyePosition.y <= runtime.carY + cabHeight + 0.7
  )
}

function getFirstPersonLevelHeight(levelId: string, nodes: Record<string, AnyNode>) {
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return DEFAULT_ELEVATOR_LEVEL_HEIGHT

  let maxTop = 0
  for (const childId of level.children) {
    const child = nodes[childId as AnyNodeId]
    if (!child) continue

    if (child.type === 'ceiling') {
      maxTop = Math.max(maxTop, child.height ?? DEFAULT_ELEVATOR_LEVEL_HEIGHT)
      continue
    }

    if (child.type === 'wall') {
      const meshY = Math.max(sceneRegistry.nodes.get(childId as AnyNodeId)?.position.y ?? 0, 0)
      maxTop = Math.max(maxTop, meshY + (child.height ?? DEFAULT_ELEVATOR_LEVEL_HEIGHT))
    }
  }

  return maxTop > 0 ? maxTop : DEFAULT_ELEVATOR_LEVEL_HEIGHT
}

function resolveElevatorColliderLevels(elevator: ElevatorNode, nodes: Record<string, AnyNode>) {
  const allLevels = resolveElevatorBuildingLevels(elevator, nodes)

  const baseYByLevelId = new Map<string, number>()
  let cumulativeY = 0
  for (const level of allLevels) {
    baseYByLevelId.set(level.id, cumulativeY)
    cumulativeY += getFirstPersonLevelHeight(level.id, nodes)
  }

  const serviceLevels = resolveElevatorServiceLevels(elevator, nodes)
  const entries = serviceLevels.map((level) => ({
    baseY: baseYByLevelId.get(level.id) ?? 0,
    id: level.id as AnyNodeId,
  }))
  const firstServedLevel = serviceLevels[0] ?? null
  const lastServedLevel = serviceLevels[serviceLevels.length - 1] ?? null
  const shaftBaseY = firstServedLevel ? (baseYByLevelId.get(firstServedLevel.id) ?? 0) : 0
  const lastServedIndex = lastServedLevel
    ? allLevels.findIndex((level) => level.id === lastServedLevel.id)
    : -1
  const nextLevel = lastServedIndex >= 0 ? allLevels[lastServedIndex + 1] : null
  const shaftTopY = nextLevel
    ? (baseYByLevelId.get(nextLevel.id) ?? cumulativeY)
    : lastServedLevel
      ? cumulativeY
      : elevator.cabHeight + 0.3

  return {
    entries,
    shaftBaseY,
    shaftTopY,
    totalHeight: Math.max(shaftTopY - shaftBaseY, elevator.cabHeight + 0.3),
  }
}

function createElevatorColliderMesh(
  elevatorId: AnyNodeId,
  kind: ElevatorColliderKind,
  size: [number, number, number],
  localPosition: [number, number, number],
  userData: Partial<ElevatorColliderUserData> = {},
) {
  const geometry = new BoxGeometry(size[0], size[1], size[2])

  const bvhGeometry = geometry as typeof geometry & {
    computeBoundsTree?: typeof computeBoundsTree
    disposeBoundsTree?: typeof disposeBoundsTree
  }
  ;(bvhGeometry as any).computeBoundsTree = computeBoundsTree
  ;(bvhGeometry as any).disposeBoundsTree = disposeBoundsTree
  bvhGeometry.computeBoundsTree?.({
    maxLeafSize: 12,
    strategy: 0,
  } as never)
  bvhGeometry.computeBoundingBox()

  const mesh = new Mesh(bvhGeometry, elevatorColliderMaterial) as unknown as ElevatorColliderMesh
  mesh.raycast = acceleratedRaycast
  mesh.matrixAutoUpdate = false
  mesh.visible = true
  mesh.userData = {
    ...userData,
    dynamic: isDynamicElevatorCollider(kind),
    elevatorId,
    excludeCollisionCheck: false,
    excludeFloatHit: false,
    friction: 0.8,
    kind,
    localPosition,
    matrixInitialized: false,
    restitution: 0.03,
    type: 'ELEVATOR_COLLIDER',
  }
  return mesh
}

function buildElevatorColliderMeshes(): ElevatorColliderMesh[] {
  const nodes = useScene.getState().nodes
  const meshes: ElevatorColliderMesh[] = []

  for (const elevatorId of sceneRegistry.byType.elevator!) {
    const typedElevatorId = elevatorId as AnyNodeId
    const node = nodes[typedElevatorId]
    if (node?.type !== 'elevator' || node.visible === false) continue

    const { entries, shaftBaseY, shaftTopY, totalHeight } = resolveElevatorColliderLevels(
      node,
      nodes,
    )
    const cabWidth = getElevatorCabWidth(node)
    const cabDepth = getElevatorCabDepth(node)
    const shaftWidth = getElevatorShaftWidth(node, cabWidth)
    const shaftDepth = getElevatorShaftDepth(node, cabDepth)
    const cabHeight = Math.max(node.cabHeight, 1.4)
    const doorWidth = Math.min(Math.max(node.doorWidth, 0.45), cabWidth - 0.18, shaftWidth - 0.18)
    const doorHeight = Math.min(Math.max(node.doorHeight, 1.2), cabHeight - 0.1)
    const doorStyle = getResolvedElevatorDoorStyle(node.doorStyle)
    const shaftHeight = Math.max(totalHeight, cabHeight + 0.3)
    const wallThickness = getElevatorShaftWallThickness(node)
    const cabFloorWidth = Math.max(cabWidth - ELEVATOR_COLLIDER_HORIZONTAL_PADDING * 2, 0.48)
    const cabFloorDepth = Math.max(cabDepth - ELEVATOR_COLLIDER_HORIZONTAL_PADDING * 2, 0.48)
    const frontWallZ = -shaftDepth / 2 - wallThickness / 2
    const frontZ = frontWallZ - wallThickness / 2 - 0.018
    const cabCenterZ = -shaftDepth / 2 + cabDepth / 2
    const leafWidth = getElevatorDoorLeafWidth(doorWidth, doorStyle)
    const doorLeafSides = getElevatorDoorLeafSides(doorStyle)
    const resolvedShaftTopY = Math.max(shaftTopY, shaftBaseY + shaftHeight)

    meshes.push(
      createElevatorColliderMesh(
        typedElevatorId,
        'shaft-back',
        [shaftWidth + wallThickness * 2, shaftHeight, wallThickness],
        [0, shaftBaseY + shaftHeight / 2, shaftDepth / 2 + wallThickness / 2],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'shaft-left',
        [wallThickness, shaftHeight, shaftDepth + wallThickness * 2],
        [-shaftWidth / 2 - wallThickness / 2, shaftBaseY + shaftHeight / 2, 0],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'shaft-right',
        [wallThickness, shaftHeight, shaftDepth + wallThickness * 2],
        [shaftWidth / 2 + wallThickness / 2, shaftBaseY + shaftHeight / 2, 0],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'shaft-top',
        [shaftWidth + wallThickness * 2, wallThickness, shaftDepth + wallThickness * 2],
        [0, shaftBaseY + shaftHeight - wallThickness / 2, 0],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'cab-floor',
        [cabFloorWidth, ELEVATOR_COLLIDER_FLOOR_THICKNESS, cabFloorDepth],
        [0, ELEVATOR_COLLIDER_FLOOR_THICKNESS / 2, cabCenterZ],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'cab-ceiling',
        [cabWidth, wallThickness, cabDepth],
        [0, cabHeight - wallThickness / 2, cabCenterZ],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'cab-back',
        [cabWidth, cabHeight, wallThickness],
        [0, cabHeight / 2, cabCenterZ + cabDepth / 2 - wallThickness / 2],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'cab-left',
        [wallThickness, cabHeight, cabDepth],
        [-cabWidth / 2 + wallThickness / 2, cabHeight / 2, cabCenterZ],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'cab-right',
        [wallThickness, cabHeight, cabDepth],
        [cabWidth / 2 - wallThickness / 2, cabHeight / 2, cabCenterZ],
      ),
      createElevatorColliderMesh(
        typedElevatorId,
        'cab-door-gate',
        [doorWidth, doorHeight, ELEVATOR_COLLIDER_DOOR_DEPTH],
        [0, doorHeight / 2, frontZ],
        { doorWidth },
      ),
      ...doorLeafSides.map((side) =>
        createElevatorColliderMesh(
          typedElevatorId,
          side === 'left' ? 'cab-door-left' : 'cab-door-right',
          [leafWidth, doorHeight, ELEVATOR_COLLIDER_DOOR_DEPTH],
          [0, doorHeight / 2, frontZ],
          { doorWidth, side },
        ),
      ),
    )

    const entrySpans = entries.map((entry, index) => {
      const nextEntry = entries[index + 1]
      return {
        entry,
        levelTopY: Math.max(nextEntry?.baseY ?? resolvedShaftTopY, entry.baseY + doorHeight + 0.24),
      }
    })

    for (const { entry, levelTopY } of entrySpans) {
      const wallDepth = wallThickness
      const levelHeight = Math.max(levelTopY - entry.baseY, doorHeight + 0.24)
      const jambWidth = Math.max((shaftWidth - doorWidth) / 2, 0.08)
      const jambCenterOffset = doorWidth / 2 + jambWidth / 2
      const headerHeight = Math.max(levelHeight - doorHeight, 0.14)

      meshes.push(
        createElevatorColliderMesh(
          typedElevatorId,
          'shaft-front-left',
          [jambWidth, levelHeight, wallDepth],
          [-jambCenterOffset, entry.baseY + levelHeight / 2, frontWallZ],
        ),
        createElevatorColliderMesh(
          typedElevatorId,
          'shaft-front-right',
          [jambWidth, levelHeight, wallDepth],
          [jambCenterOffset, entry.baseY + levelHeight / 2, frontWallZ],
        ),
        createElevatorColliderMesh(
          typedElevatorId,
          'shaft-front-header',
          [shaftWidth, headerHeight, wallDepth],
          [0, entry.baseY + doorHeight + headerHeight / 2, frontWallZ],
        ),
        createElevatorColliderMesh(
          typedElevatorId,
          'landing-door-gate',
          [doorWidth, doorHeight, ELEVATOR_COLLIDER_DOOR_DEPTH],
          [0, entry.baseY + doorHeight / 2, frontZ - 0.02],
          { doorWidth, levelId: entry.id },
        ),
        ...doorLeafSides.map((side) =>
          createElevatorColliderMesh(
            typedElevatorId,
            side === 'left' ? 'landing-door-left' : 'landing-door-right',
            [leafWidth, doorHeight, ELEVATOR_COLLIDER_DOOR_DEPTH],
            [0, entry.baseY + doorHeight / 2, frontZ - 0.02],
            { doorWidth, levelId: entry.id, side },
          ),
        ),
      )
    }
  }

  return meshes
}

function disposeElevatorColliderMeshes(meshes: ElevatorColliderMesh[]) {
  for (const mesh of meshes) {
    const geometry = mesh.geometry as typeof mesh.geometry & {
      disposeBoundsTree?: typeof disposeBoundsTree
    }
    geometry.disposeBoundsTree?.()
    geometry.dispose()
  }
}

const resolvePlacedSpawnNode = (
  nodes: ReturnType<typeof useScene.getState>['nodes'],
  _levelId: string | null,
) => {
  const candidates = Object.values(nodes).filter((node) => node.type === 'spawn')
  if (candidates.length === 0) return null

  return [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0] ?? null
}

export const FirstPersonControls = () => {
  const { camera, gl } = useThree()
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const placedSpawnNode = useScene((state) => resolvePlacedSpawnNode(state.nodes, selectedLevelId))
  const controllerRef = useRef<BVHEcctrlApi | null>(null)
  const movementInputRef = useRef<MovementInput>({ ...inactiveMovementInput })
  const hadPointerLockRef = useRef(false)
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const interactableTargetRef = useRef<FirstPersonInteractableTarget | null>(null)
  const [isElevatorRideLocked, setIsElevatorRideLocked] = useState(false)
  const ridingElevatorRef = useRef<{
    elevatorId: AnyNodeId
    localControllerY: number | null
    previousCarY: number
  } | null>(null)
  const rideLockedRef = useRef(false)
  const worldRef = useRef<FirstPersonColliderWorld | null>(null)
  const elevatorColliderMeshesRef = useRef<ElevatorColliderMesh[]>([])
  const [world, setWorld] = useState<FirstPersonColliderWorld | null>(null)
  const [elevatorColliderMeshes, setElevatorColliderMeshes] = useState<ElevatorColliderMesh[]>([])
  const [controllerStart, setControllerStart] = useState<{
    position: [number, number, number]
    yaw: number
  } | null>(null)

  const replaceColliderWorld = useCallback((nextWorld: FirstPersonColliderWorld | null) => {
    worldRef.current?.dispose()
    worldRef.current = nextWorld
    setWorld(nextWorld)
  }, [])

  const replaceElevatorColliderMeshes = useCallback((nextMeshes: ElevatorColliderMesh[]) => {
    disposeElevatorColliderMeshes(elevatorColliderMeshesRef.current)
    elevatorColliderMeshesRef.current = nextMeshes
    setElevatorColliderMeshes(nextMeshes)
  }, [])

  const rebuildColliderWorld = useCallback(() => {
    replaceColliderWorld(buildFirstPersonColliderWorldFromRegistry())
    replaceElevatorColliderMeshes(buildElevatorColliderMeshes())
  }, [replaceColliderWorld, replaceElevatorColliderMeshes])

  const setElevatorRideLocked = useCallback((locked: boolean) => {
    if (rideLockedRef.current === locked) return
    rideLockedRef.current = locked
    setIsElevatorRideLocked(locked)
  }, [])

  const setControllerApi = useCallback((api: BVHEcctrlApi | null) => {
    controllerRef.current = api
    if (api) {
      api.setMovement(movementInputRef.current)
    }
  }, [])

  const resolveInteractableDoorId = useCallback((): AnyNodeId | null => {
    const nodes = useScene.getState().nodes
    camera.updateMatrixWorld(true)
    doorInteractionRaycaster.setFromCamera(centerScreenPoint, camera)

    let closestDoorId: AnyNodeId | null = null
    let closestDistance = DOOR_INTERACTION_DISTANCE

    for (const doorId of sceneRegistry.byType.door!) {
      const node = nodes[doorId as AnyNodeId]
      if (node?.type !== 'door') continue
      if (node.openingKind === 'opening') continue
      if (node.segments.every((segment) => segment.type === 'empty')) continue

      const object = sceneRegistry.nodes.get(doorId)
      if (!object) continue

      object.updateWorldMatrix(true, true)

      const placementHit = doorInteractionRaycaster
        .intersectObject(object, true)
        .find((intersection) => intersection.distance <= DOOR_INTERACTION_DISTANCE)
      if (placementHit && placementHit.distance < closestDistance) {
        closestDoorId = doorId as AnyNodeId
        closestDistance = placementHit.distance
      }

      const leafW = node.width - 2 * node.frameThickness
      const leafH = node.height - node.frameThickness
      if (leafW <= 0 || leafH <= 0) continue

      const leafCenterY = -node.frameThickness / 2

      if (isOperationDoorType(node.doorType)) {
        doorOpeningMatrix
          .copy(object.matrixWorld)
          .multiply(new Matrix4().makeTranslation(0, leafCenterY, 0))
        doorOpeningInverseMatrix.copy(doorOpeningMatrix).invert()
        doorOpeningBox.min.set(-leafW / 2, -leafH / 2, -DOOR_LEAF_INTERACTION_DEPTH / 2)
        doorOpeningBox.max.set(leafW / 2, leafH / 2, DOOR_LEAF_INTERACTION_DEPTH / 2)
        doorOpeningLocalRay
          .copy(doorInteractionRaycaster.ray)
          .applyMatrix4(doorOpeningInverseMatrix)

        const localOpeningHit = doorOpeningLocalRay.intersectBox(
          doorOpeningBox,
          doorOpeningLocalHit,
        )
        if (!localOpeningHit) continue

        doorOpeningWorldHit.copy(localOpeningHit).applyMatrix4(doorOpeningMatrix)
        const openingHitDistance = doorOpeningWorldHit.distanceTo(
          doorInteractionRaycaster.ray.origin,
        )

        if (
          openingHitDistance <= DOOR_INTERACTION_DISTANCE &&
          openingHitDistance < closestDistance
        ) {
          closestDoorId = doorId as AnyNodeId
          closestDistance = openingHitDistance
        }
        continue
      }

      const hingeX = node.hingesSide === 'right' ? leafW / 2 : -leafW / 2
      const swingDirectionSign = node.swingDirection === 'inward' ? 1 : -1
      const hingeDirectionSign = node.hingesSide === 'right' ? 1 : -1
      const currentSwingAngle =
        useInteractive.getState().doors[doorId as AnyNodeId]?.swingAngle ?? node.swingAngle ?? 0
      const clampedSwingAngle = Math.max(0, Math.min(DOOR_SWING_OPEN_ANGLE, currentSwingAngle))
      const leafSwingRotation = clampedSwingAngle * swingDirectionSign * hingeDirectionSign

      doorLeafMatrix
        .copy(object.matrixWorld)
        .multiply(new Matrix4().makeTranslation(hingeX, 0, 0))
        .multiply(new Matrix4().makeRotationY(leafSwingRotation))
        .multiply(new Matrix4().makeTranslation(-hingeX, leafCenterY, 0))
      doorLeafInverseMatrix.copy(doorLeafMatrix).invert()
      doorLeafBox.min.set(-leafW / 2, -leafH / 2, -DOOR_LEAF_INTERACTION_DEPTH / 2)
      doorLeafBox.max.set(leafW / 2, leafH / 2, DOOR_LEAF_INTERACTION_DEPTH / 2)
      doorLeafLocalRay.copy(doorInteractionRaycaster.ray).applyMatrix4(doorLeafInverseMatrix)

      const localHit = doorLeafLocalRay.intersectBox(doorLeafBox, doorLeafLocalHit)
      if (!localHit) continue

      doorLeafWorldHit.copy(localHit).applyMatrix4(doorLeafMatrix)
      const hitDistance = doorLeafWorldHit.distanceTo(doorInteractionRaycaster.ray.origin)

      if (hitDistance <= DOOR_INTERACTION_DISTANCE && hitDistance < closestDistance) {
        closestDoorId = doorId as AnyNodeId
        closestDistance = hitDistance
      }
    }

    return closestDoorId
  }, [camera])

  const resolveInteractableWindowId = useCallback((): AnyNodeId | null => {
    const nodes = useScene.getState().nodes
    camera.updateMatrixWorld(true)
    windowInteractionRaycaster.setFromCamera(centerScreenPoint, camera)

    let closestWindowId: AnyNodeId | null = null
    let closestDistance = DOOR_INTERACTION_DISTANCE

    for (const windowId of sceneRegistry.byType.window!) {
      const node = nodes[windowId as AnyNodeId]
      if (node?.type !== 'window') continue
      if (node.openingKind === 'opening') continue
      if (!isOperableWindowType(node.windowType)) continue

      const object = sceneRegistry.nodes.get(windowId)
      if (!object) continue

      const hit = windowInteractionRaycaster
        .intersectObject(object, true)
        .find((intersection) => intersection.distance <= DOOR_INTERACTION_DISTANCE)
      if (!(hit && hit.distance < closestDistance)) continue

      closestWindowId = windowId as AnyNodeId
      closestDistance = hit.distance
    }

    return closestWindowId
  }, [camera])

  const resolveInteractableElevatorTarget =
    useCallback((): FirstPersonInteractableTarget | null => {
      const nodes = useScene.getState().nodes
      camera.updateMatrixWorld(true)
      elevatorInteractionRaycaster.setFromCamera(centerScreenPoint, camera)

      let closestTarget: FirstPersonInteractableTarget | null = null
      let closestDistance = DOOR_INTERACTION_DISTANCE

      for (const elevatorId of sceneRegistry.byType.elevator!) {
        const typedElevatorId = elevatorId as AnyNodeId
        const node = nodes[typedElevatorId]
        if (node?.type !== 'elevator') continue

        const object = sceneRegistry.nodes.get(typedElevatorId)
        if (!object) continue

        const runtime = useInteractive.getState().elevators[typedElevatorId]
        object.updateWorldMatrix(true, true)
        if (runtime) {
          elevatorLocalEyePosition.copy(camera.position)
          object.worldToLocal(elevatorLocalEyePosition)
        }
        const canUseCabButtons =
          runtime && isInsideElevatorCab(node, runtime, elevatorLocalEyePosition)

        const intersections = elevatorInteractionRaycaster.intersectObject(object, true)
        for (const intersection of intersections) {
          if (intersection.distance > closestDistance) continue

          const target = resolveElevatorButtonTarget(intersection.object)
          if (!target || target.elevatorId !== elevatorId) continue
          if (target.action === 'request-level') {
            if (!target.levelId || nodes[target.levelId]?.type !== 'level') continue
          }
          if (target.buttonKind === 'cab' && !canUseCabButtons) continue

          closestTarget = {
            action: target.action,
            buttonKind: target.buttonKind,
            id: target.elevatorId,
            levelId: target.levelId,
            type: 'elevator',
          }
          closestDistance = intersection.distance
        }
      }

      return closestTarget
    }, [camera])

  const resolveInteractableTarget = useCallback((): FirstPersonInteractableTarget | null => {
    const elevatorTarget = resolveInteractableElevatorTarget()
    if (elevatorTarget) return elevatorTarget

    const doorId = resolveInteractableDoorId()
    if (doorId) return { id: doorId, type: 'door' }

    const windowId = resolveInteractableWindowId()
    if (windowId) return { id: windowId, type: 'window' }

    return null
  }, [resolveInteractableDoorId, resolveInteractableElevatorTarget, resolveInteractableWindowId])

  const toggleInteractableTarget = useCallback(() => {
    const target = interactableTargetRef.current ?? resolveInteractableTarget()
    if (!target) return

    if (target.type === 'elevator') {
      if (target.buttonKind === 'cab') {
        const state = useInteractive.getState().elevators[target.id]
        if (state) {
          ridingElevatorRef.current = {
            elevatorId: target.id,
            localControllerY: null,
            previousCarY: state.carY,
          }
        }
      }
      if (target.action === 'open-door') {
        openElevatorDoor(target.id)
        return
      }
      if (target.levelId) {
        const targetElevatorId =
          target.buttonKind === 'landing'
            ? resolveElevatorDispatchTarget({
                elevators: useInteractive.getState().elevators,
                levelId: target.levelId,
                nodes: useScene.getState().nodes,
                requestedElevatorId: target.id,
              })
            : target.id
        requestElevatorLevel(targetElevatorId, target.levelId)
      }
      return
    }

    if (target.type === 'window') {
      const node = useScene.getState().nodes[target.id]
      if (
        node?.type !== 'window' ||
        node.openingKind === 'opening' ||
        !isOperableWindowType(node.windowType)
      ) {
        return
      }

      toggleWindowOpenState(target.id, { persist: false })
      return
    }

    const doorId = target.id

    const node = useScene.getState().nodes[doorId]
    if (node?.type !== 'door' || node.openingKind === 'opening') return

    toggleDoorOpenState(doorId, { persist: false })
  }, [resolveInteractableTarget])

  const closeInteractableTarget = useCallback(() => {
    const target = interactableTargetRef.current ?? resolveInteractableTarget()
    if (!target) return

    if (target.type === 'elevator') return

    if (target.type === 'window') {
      const node = useScene.getState().nodes[target.id]
      if (
        node?.type !== 'window' ||
        node.openingKind === 'opening' ||
        !isOperableWindowType(node.windowType)
      ) {
        return
      }

      closeWindowOpenState(target.id, { persist: false })
      return
    }

    const node = useScene.getState().nodes[target.id]
    if (node?.type !== 'door' || node.openingKind === 'opening') return

    closeDoorOpenState(target.id, { persist: false })
  }, [resolveInteractableTarget])

  const placedSpawn = useMemo<FirstPersonSpawn | null>(() => {
    if (!(placedSpawnNode && placedSpawnNode.type === 'spawn')) return null

    const spawnObject = sceneRegistry.nodes.get(placedSpawnNode.id)
    if (spawnObject) {
      spawnObject.updateWorldMatrix(true, false)
      spawnObject.getWorldPosition(spawnWorldPosition)
      spawnWorldEuler.setFromRotationMatrix(spawnObject.matrixWorld, 'YXZ')

      return {
        position: [
          spawnWorldPosition.x,
          spawnWorldPosition.y + FIRST_PERSON_SPAWN_EYE_HEIGHT,
          spawnWorldPosition.z,
        ],
        yaw: spawnWorldEuler.y,
      }
    }

    return {
      position: [
        placedSpawnNode.position[0],
        placedSpawnNode.position[1] + FIRST_PERSON_SPAWN_EYE_HEIGHT,
        placedSpawnNode.position[2],
      ],
      yaw: placedSpawnNode.rotation,
    }
  }, [placedSpawnNode])

  useEffect(() => {
    rebuildColliderWorld()

    return () => {
      worldRef.current?.dispose()
      worldRef.current = null
      disposeElevatorColliderMeshes(elevatorColliderMeshesRef.current)
      elevatorColliderMeshesRef.current = []
      setElevatorColliderMeshes([])
      setWorld(null)
    }
  }, [rebuildColliderWorld])

  useEffect(() => {
    emitter.on('door:animation-completed', rebuildColliderWorld)
    emitter.on('window:animation-completed', rebuildColliderWorld)
    return () => {
      emitter.off('door:animation-completed', rebuildColliderWorld)
      emitter.off('window:animation-completed', rebuildColliderWorld)
    }
  }, [rebuildColliderWorld])

  useEffect(() => {
    if (!world) return
    if (controllerStart) return

    const spawn = placedSpawn ?? deriveFirstPersonSpawn(camera, world)
    const [x, y, z] = spawn.position
    yawRef.current = spawn.yaw
    pitchRef.current = 0
    setControllerStart({
      position: [x, y - CONTROLLER_CENTER_FROM_EYE, z],
      yaw: spawn.yaw,
    })
  }, [camera, controllerStart, placedSpawn, world])

  useEffect(() => {
    const canvas = gl.domElement
    focusFirstPersonCanvas(canvas)

    const frame = window.requestAnimationFrame(() => focusFirstPersonCanvas(canvas))
    return () => window.cancelAnimationFrame(frame)
  }, [gl])

  useEffect(() => {
    const canvas = gl.domElement
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return

      yawRef.current -= e.movementX * LOOK_SENSITIVITY
      pitchRef.current = Math.max(
        -(Math.PI / 2 - 0.05),
        Math.min(Math.PI / 2 - 0.05, pitchRef.current - e.movementY * LOOK_SENSITIVITY),
      )
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!canvas.contains(target)) return
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.()
      }
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      if (event.button !== 0) return

      event.preventDefault()
      event.stopPropagation()
      toggleInteractableTarget()
    }

    const handlePointerLockChange = () => {
      const isLocked = document.pointerLockElement === canvas
      if (isLocked) {
        hadPointerLockRef.current = true
        return
      }

      if (hadPointerLockRef.current && useEditor.getState().isFirstPersonMode) {
        useEditor.getState().setFirstPersonMode(false)
      }
    }

    handlePointerLockChange()
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('click', handleClick)
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('pointerlockchange', handlePointerLockChange)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock()
      }
    }
  }, [gl, toggleInteractableTarget])

  useEffect(() => {
    const canvas = gl.domElement

    const applyMovementKey = (event: KeyboardEvent, active: boolean) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return false
      }

      const movement = getMovementInputForKey(event.code, active)
      if (!movement) return false

      event.preventDefault()
      Object.assign(movementInputRef.current, movement)
      controllerRef.current?.setMovement(movement)
      return true
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const handledMovement = applyMovementKey(event, true)
      if (handledMovement) return

      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.code === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (document.pointerLockElement === canvas) {
          document.exitPointerLock()
        }
        useEditor.getState().setFirstPersonMode(false)
      } else if (event.code === 'KeyE' || event.code === 'KeyR') {
        event.preventDefault()
        event.stopPropagation()
        toggleInteractableTarget()
      } else if (event.code === 'KeyT') {
        event.preventDefault()
        event.stopPropagation()
        closeInteractableTarget()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      applyMovementKey(event, false)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [closeInteractableTarget, gl, toggleInteractableTarget])

  const syncElevatorColliderMeshes = useCallback(() => {
    const nodes = useScene.getState().nodes
    const interactive = useInteractive.getState()

    for (const mesh of elevatorColliderMeshesRef.current) {
      const { doorWidth, dynamic, elevatorId, kind, levelId, localPosition, side } = mesh.userData
      const node = nodes[elevatorId]
      const runtime = interactive.elevators[elevatorId]
      const object = sceneRegistry.nodes.get(elevatorId)
      if (!(node?.type === 'elevator' && object && node.visible !== false)) {
        mesh.visible = false
        continue
      }

      if (!dynamic && mesh.userData.matrixInitialized && mesh.visible) {
        continue
      }

      let [localX, localY, localZ] = localPosition
      const isCabCollider = kind.startsWith('cab-')
      const isDoorCollider = kind === 'landing-door-left' || kind === 'landing-door-right'
      const isCabDoorGate = kind === 'cab-door-gate'
      const isLandingDoorGate = kind === 'landing-door-gate'

      if (isCabCollider) {
        localY += runtime?.carY ?? 0
      }

      if (kind === 'cab-door-left' || kind === 'cab-door-right') {
        if (!runtime) {
          mesh.visible = false
          continue
        }
        localX = getElevatorDoorLeafX(
          side ?? 'left',
          doorWidth ?? node.doorWidth,
          runtime.doorOpen,
          node.doorStyle,
        )
        mesh.visible = true
      } else if (isCabDoorGate) {
        if (!runtime) {
          mesh.visible = false
          continue
        }
        mesh.visible = runtime.doorOpen < ELEVATOR_ENTRY_DOOR_OPEN_THRESHOLD
      } else if (isDoorCollider) {
        const doorOpen = runtime?.currentLevelId === levelId ? (runtime?.doorOpen ?? 0) : 0
        localX = getElevatorDoorLeafX(
          side ?? 'left',
          doorWidth ?? node.doorWidth,
          doorOpen,
          node.doorStyle,
        )
        mesh.visible = true
      } else if (isLandingDoorGate) {
        const doorOpen = runtime?.currentLevelId === levelId ? (runtime?.doorOpen ?? 0) : 0
        mesh.visible = doorOpen < ELEVATOR_ENTRY_DOOR_OPEN_THRESHOLD
      } else {
        mesh.visible = true
      }

      object.updateWorldMatrix(true, false)
      elevatorColliderMatrix.copy(object.matrixWorld)
      elevatorColliderMatrix.multiply(
        elevatorColliderLocalMatrix.makeTranslation(localX, localY, localZ),
      )
      mesh.matrix.copy(elevatorColliderMatrix)
      mesh.matrixWorld.copy(elevatorColliderMatrix)
      mesh.userData.matrixInitialized = true
    }
  }, [])

  useFrame(() => {
    syncElevatorColliderMeshes()
  }, -1)

  const syncElevatorRide = useCallback(
    (group: Group) => {
      const nodes = useScene.getState().nodes
      const interactive = useInteractive.getState()
      const activeRide = ridingElevatorRef.current
      let nextRide: {
        cabHeight: number
        cabCenterZ: number
        carY: number
        doorOpen: number
        elevatorId: AnyNodeId
        halfDepth: number
        halfWidth: number
        object: Object3D
        phase: NonNullable<(typeof interactive.elevators)[AnyNodeId]>['phase']
      } | null = null

      const elevatorIds = activeRide
        ? [
            activeRide.elevatorId,
            ...Array.from(sceneRegistry.byType.elevator!).filter(
              (elevatorId) => elevatorId !== activeRide.elevatorId,
            ),
          ]
        : Array.from(sceneRegistry.byType.elevator!)

      for (const elevatorId of elevatorIds) {
        const typedElevatorId = elevatorId as AnyNodeId
        const node = nodes[typedElevatorId]
        if (node?.type !== 'elevator') continue

        const runtime = interactive.elevators[typedElevatorId]
        const object = sceneRegistry.nodes.get(typedElevatorId)
        if (!(runtime && object)) continue

        object.updateWorldMatrix(true, true)
        elevatorLocalEyePosition.copy(camera.position)
        object.worldToLocal(elevatorLocalEyePosition)

        const halfWidth = getElevatorCabWidth(node) / 2 - ELEVATOR_RIDE_HORIZONTAL_PADDING
        const halfDepth = getElevatorCabDepth(node) / 2 - ELEVATOR_RIDE_HORIZONTAL_PADDING
        const cabCenterZ = getElevatorCabCenterZ(node)
        const cabHeight = Math.max(node.cabHeight, 1.4)
        const insideFootprint =
          Math.abs(elevatorLocalEyePosition.x) <= Math.max(halfWidth, 0.24) &&
          Math.abs(elevatorLocalEyePosition.z - cabCenterZ) <= Math.max(halfDepth, 0.24)
        const insideCabHeight =
          elevatorLocalEyePosition.y >= runtime.carY + 0.35 &&
          elevatorLocalEyePosition.y <= runtime.carY + cabHeight + 0.7
        const continuingRide =
          activeRide?.elevatorId === typedElevatorId &&
          insideFootprint &&
          elevatorLocalEyePosition.y >= runtime.carY - 0.2 &&
          elevatorLocalEyePosition.y <= runtime.carY + cabHeight + 1.25

        if ((insideFootprint && insideCabHeight) || continuingRide) {
          nextRide = {
            cabHeight,
            cabCenterZ,
            carY: runtime.carY,
            doorOpen: runtime.doorOpen,
            elevatorId: typedElevatorId,
            halfDepth: Math.max(halfDepth, 0.24),
            halfWidth: Math.max(halfWidth, 0.24),
            object,
            phase: runtime.phase,
          }
          break
        }
      }

      if (!nextRide) {
        ridingElevatorRef.current = null
        setElevatorRideLocked(false)
        return
      }

      const previousCarY =
        activeRide?.elevatorId === nextRide.elevatorId ? activeRide.previousCarY : nextRide.carY
      const deltaY = nextRide.carY - previousCarY
      nextRide.object.updateWorldMatrix(true, true)
      elevatorLocalControllerPosition.copy(group.position)
      nextRide.object.worldToLocal(elevatorLocalControllerPosition)
      const localControllerY =
        activeRide?.elevatorId === nextRide.elevatorId && activeRide.localControllerY !== null
          ? activeRide.localControllerY
          : elevatorLocalControllerPosition.y - nextRide.carY

      if (Math.abs(deltaY) > 0.0001) {
        group.position.y += deltaY
        controllerRef.current?.resetLinVel()
      }

      const shouldLockToCab =
        nextRide.phase === 'closing' ||
        nextRide.phase === 'moving' ||
        (nextRide.phase === 'opening' && nextRide.doorOpen < ELEVATOR_ENTRY_DOOR_OPEN_THRESHOLD)
      if (shouldLockToCab) {
        elevatorLocalControllerPosition.copy(group.position)
        nextRide.object.worldToLocal(elevatorLocalControllerPosition)
        const desiredLocalY = nextRide.carY + localControllerY
        if (Math.abs(elevatorLocalControllerPosition.y - desiredLocalY) > 0.002) {
          elevatorLocalControllerPosition.y = desiredLocalY
          elevatorWorldControllerPosition.copy(elevatorLocalControllerPosition)
          nextRide.object.localToWorld(elevatorWorldControllerPosition)
          group.position.y = elevatorWorldControllerPosition.y
          controllerRef.current?.resetLinVel()
          elevatorLocalControllerPosition.copy(group.position)
          nextRide.object.worldToLocal(elevatorLocalControllerPosition)
        }

        const clampedX = Math.max(
          -nextRide.halfWidth,
          Math.min(nextRide.halfWidth, elevatorLocalControllerPosition.x),
        )
        const clampedZ = Math.max(
          nextRide.cabCenterZ - nextRide.halfDepth,
          Math.min(nextRide.cabCenterZ + nextRide.halfDepth, elevatorLocalControllerPosition.z),
        )

        if (
          Math.abs(clampedX - elevatorLocalControllerPosition.x) > 0.0001 ||
          Math.abs(clampedZ - elevatorLocalControllerPosition.z) > 0.0001
        ) {
          elevatorLocalControllerPosition.x = clampedX
          elevatorLocalControllerPosition.z = clampedZ
          elevatorWorldControllerPosition.copy(elevatorLocalControllerPosition)
          nextRide.object.localToWorld(elevatorWorldControllerPosition)
          group.position.x = elevatorWorldControllerPosition.x
          group.position.z = elevatorWorldControllerPosition.z
          controllerRef.current?.resetLinVel()
        }
      }

      setElevatorRideLocked(shouldLockToCab)

      ridingElevatorRef.current = {
        elevatorId: nextRide.elevatorId,
        localControllerY,
        previousCarY: nextRide.carY,
      }
    },
    [camera, setElevatorRideLocked],
  )

  useFrame(() => {
    if (!controllerRef.current?.group) return

    const group = controllerRef.current.group

    // The site ground collider is effectively unbounded, but scenes without a
    // site node only have finite fallback floors — if the controller still ends
    // up below every collider it can never land, so put it back at the spawn.
    // Prefer the live spawn node over the mount-time start position so a spawn
    // moved mid-walkthrough doesn't respawn the player at stale coordinates.
    const worldBounds = worldRef.current?.bounds
    if (worldBounds && group.position.y < worldBounds.min.y - VOID_FALL_RESPAWN_DEPTH) {
      const respawnPosition = placedSpawn
        ? [
            placedSpawn.position[0],
            placedSpawn.position[1] - CONTROLLER_CENTER_FROM_EYE,
            placedSpawn.position[2],
          ]
        : controllerStart?.position
      if (respawnPosition) {
        group.position.set(respawnPosition[0]!, respawnPosition[1]!, respawnPosition[2]!)
        controllerRef.current.resetLinVel()
        ridingElevatorRef.current = null
        setElevatorRideLocked(false)
      }
    }

    group.rotation.y = 0
    camera.position.copy(group.position).add(cameraOffset)
    cameraEuler.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(cameraEuler)
    camera.updateMatrixWorld(true)
    syncElevatorRide(group)
    camera.position.copy(group.position).add(cameraOffset)
    camera.updateMatrixWorld(true)

    const nextInteractableTarget = resolveInteractableTarget()
    const previousInteractableTarget = interactableTargetRef.current
    if (
      getInteractableTargetKey(previousInteractableTarget) !==
      getInteractableTargetKey(nextInteractableTarget)
    ) {
      interactableTargetRef.current = nextInteractableTarget
      useViewer.getState().setHoveredId(nextInteractableTarget?.id ?? null)
    }
  }, 2.5)

  useEffect(() => {
    return () => {
      if (useViewer.getState().hoveredId === interactableTargetRef.current?.id) {
        useViewer.getState().setHoveredId(null)
      }
    }
  }, [])

  const firstPersonColliderMeshes = useMemo(
    () => (world ? [world.mesh, ...elevatorColliderMeshes] : elevatorColliderMeshes),
    [world, elevatorColliderMeshes],
  )

  if (!world) {
    return null
  }

  return (
    <>
      {controllerStart && (
        <KeyboardControls map={keyboardMap}>
          <BVHEcctrl
            acceleration={26}
            airDragFactor={0.3}
            colliderCapsuleArgs={[0.25, 0.8, 4, 8]}
            colliderMeshes={firstPersonColliderMeshes}
            collisionCheckIteration={3}
            collisionPushBackDamping={0.1}
            collisionPushBackThreshold={0.001}
            debug={false}
            deceleration={30}
            delay={0}
            fallGravityFactor={4}
            floatCheckType="BOTH"
            floatDampingC={36}
            floatHeight={0.5}
            floatPullBackHeight={0.35}
            floatSensorRadius={0.15}
            floatSpringK={1200}
            gravity={9.81}
            jumpVel={5}
            key="first-person-controller"
            maxRunSpeed={5}
            maxSlope={1.2}
            maxWalkSpeed={2}
            paused={isElevatorRideLocked}
            position={controllerStart.position}
            ref={setControllerApi}
          />
        </KeyboardControls>
      )}
    </>
  )
}

/**
 * Overlay UI for first-person mode: crosshair, controls hint, exit button.
 * Rendered as a regular DOM overlay (not inside the Canvas).
 */
export const FirstPersonOverlay = ({ onExit }: { onExit: () => void }) => {
  const [isLocked, setIsLocked] = useState(false)
  const hasPlacedSpawn = useScene((state) =>
    Object.values(state.nodes).some((node) => node.type === 'spawn'),
  )

  useEffect(() => {
    const handlePointerLockChange = () => {
      setIsLocked(document.pointerLockElement != null)
    }

    handlePointerLockChange()
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
    }
  }, [])

  const handleExit = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    onExit()
  }, [onExit])

  return (
    <>
      {isLocked && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="relative h-7 w-7">
            <div className="absolute top-1/2 left-1/2 h-px w-7 -translate-x-1/2 -translate-y-1/2 bg-white/60" />
            <div className="absolute top-1/2 left-1/2 h-7 w-px -translate-x-1/2 -translate-y-1/2 bg-white/60" />
          </div>
        </div>
      )}

      <div className="absolute top-4 right-4 z-50">
        <button
          className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border/40 bg-background/90 px-4 py-2 font-medium text-foreground text-sm shadow-lg backdrop-blur-xl transition-colors hover:bg-background"
          onClick={handleExit}
          type="button"
        >
          <kbd className="rounded border border-border/50 bg-accent/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
          Exit Street View
        </button>
      </div>

      {!hasPlacedSpawn && (
        <div className="absolute top-4 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-2xl border border-sky-300/35 bg-slate-950/88 px-4 py-2 text-center text-slate-100 text-sm shadow-lg backdrop-blur-xl">
            Place a Spawn Point from the Build tab to control where walkthrough starts.
          </div>
        </div>
      )}

      {isLocked && (
        <div className="pointer-events-none absolute top-1/2 right-6 z-40 -translate-y-1/2">
          <div className="flex min-w-[148px] flex-col gap-3 rounded-2xl border border-border/35 bg-background/80 px-4 py-4 shadow-lg backdrop-blur-xl">
            <ControlHint keys={['W', 'A', 'S', 'D']} label="Move" />
            <div className="h-px w-full bg-border/30" />
            <InlineControlHint keyLabel="Space" label="Jump" />
            <InlineControlHint keyLabel="Shift" label="Sprint" />
            <InlineControlHint keyLabel="E / R" label="Interact" />
            <InlineControlHint keyLabel="T" label="Close" />
            <div className="h-px w-full bg-border/30" />
            <span className="text-center text-muted-foreground/60 text-xs">
              Click to look around
            </span>
          </div>
        </div>
      )}
    </>
  )
}

function ControlHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span className="font-medium text-[10px] text-muted-foreground/60 tracking-[0.03em]">
        {label}
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1">
        {keys.map((key) => (
          <kbd
            className="flex h-5 min-w-5 items-center justify-center rounded border border-border/50 bg-accent/40 px-1 font-mono text-[10px] text-foreground/80 leading-none"
            key={key}
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  )
}

function InlineControlHint({ label, keyLabel }: { label: string; keyLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium text-[10px] text-muted-foreground/60 uppercase tracking-[0.03em]">
        {label}
      </span>
      <kbd className="flex h-5 min-w-5 items-center justify-center rounded border border-border/50 bg-accent/40 px-1.5 font-mono text-[10px] text-foreground/80 leading-none">
        {keyLabel}
      </kbd>
    </div>
  )
}
