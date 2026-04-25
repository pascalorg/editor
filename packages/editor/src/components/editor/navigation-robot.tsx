'use client'

import { sceneRegistry, useLiveTransforms } from '@pascal-app/core'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { type MutableRefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  type AnimationAction,
  type AnimationClip,
  Box3,
  BufferGeometry,
  type Camera,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  LoopOnce,
  LoopRepeat,
  type Material,
  MathUtils,
  Matrix3,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  type Raycaster,
  type Scene,
  Vector2,
  Vector3,
  type VectorKeyframeTrack,
} from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { float, materialOpacity, mix, positionWorld, smoothstep, uniform, uv } from 'three/tsl'
import { MeshBasicNodeMaterial, RenderTarget } from 'three/webgpu'
import {
  measureNavigationPerf,
  mergeNavigationPerfMeta,
  recordNavigationPerfMark,
  recordNavigationPerfSample,
} from '../../lib/navigation-performance'
import navigationVisualsStore from '../../store/use-navigation-visuals'

const NAVIGATION_ROBOT_ASSET_PATH = '/navigation/proto_pascal_robot.glb'
const NAVIGATION_ROBOT_CLIP_OVERRIDE_STORAGE_KEY = 'pascalNavigationRobotClipOverrides'
const NAVIGATION_ROBOT_CLIP_OVERRIDE_EVENT = 'pascal-robot-clip-overrides-change'
const NAVIGATION_ROBOT_ASSET_VERSION_STORAGE_KEY = 'pascalNavigationRobotAssetVersion'
const NAVIGATION_ROBOT_ASSET_UPDATED_EVENT = 'pascal-robot-asset-updated'
const NAVIGATION_ROBOT_MATERIAL_WARMUP_FALLBACK_MS = 5000
const DEFAULT_NAVIGATION_ROBOT_IDLE_CLIP_NAMES = [
  'Idle_9',
  'Idle_11',
  'Idle_7',
  'Idle_12',
  'Idle_Talking_Loop',
  'Idle_Loop',
] as const
const DEFAULT_NAVIGATION_ROBOT_WALK_CLIP_NAMES = [
  'Walking',
  'Walk_Loop',
  'Walk_Formal_Loop',
  'Jog_Fwd_Loop',
] as const
const DEFAULT_NAVIGATION_ROBOT_RUN_CLIP_NAMES = ['Running', 'Sprint_Loop', 'Jog_Fwd_Loop'] as const
const EXCLUDED_NAVIGATION_ROBOT_CLIP_NAMES = new Set([
  'Funky_Walk',
  'Stylish_Walk',
  'Stylish_Walk_inplace',
  'run_fast_3',
  'run_fast_3_inplace',
])

function isTrueWebGPUBackend(
  renderer: unknown,
): renderer is { backend: { isWebGPUBackend: true } } {
  return (renderer as { backend?: { isWebGPUBackend?: boolean } }).backend?.isWebGPUBackend === true
}

function getRendererDrawingBufferSize(
  renderer: {
    domElement?: { height?: number; width?: number }
    getDrawingBufferSize?: (target: Vector2) => Vector2
  },
  scratch = new Vector2(),
) {
  const canvasWidth = Math.max(0, Math.floor(renderer.domElement?.width ?? 0))
  const canvasHeight = Math.max(0, Math.floor(renderer.domElement?.height ?? 0))

  if (canvasWidth > 1 && canvasHeight > 1) {
    return scratch.set(canvasWidth, canvasHeight)
  }

  if (typeof renderer.getDrawingBufferSize === 'function') {
    return renderer.getDrawingBufferSize(scratch)
  }

  return scratch.set(Math.max(1, canvasWidth || 1), Math.max(1, canvasHeight || 1))
}

type NavigationRobotClipCategory = 'idle' | 'run' | 'walk'

type NavigationRobotClipOverrideState = {
  idle: string | null
  run: string | null
  walk: string | null
}

const DEFAULT_NAVIGATION_ROBOT_CLIP_OVERRIDES: NavigationRobotClipOverrideState = {
  idle: null,
  run: null,
  walk: null,
}

function normalizeNavigationRobotClipOverrides(value: unknown): NavigationRobotClipOverrideState {
  if (!(value && typeof value === 'object')) {
    return DEFAULT_NAVIGATION_ROBOT_CLIP_OVERRIDES
  }

  const candidate = value as Partial<Record<NavigationRobotClipCategory, unknown>>
  return {
    idle: typeof candidate.idle === 'string' ? candidate.idle : null,
    run: typeof candidate.run === 'string' ? candidate.run : null,
    walk: typeof candidate.walk === 'string' ? candidate.walk : null,
  }
}

function getNavigationRobotClipNames(
  defaultClipNames: readonly string[],
  overrideClipName: string | null | undefined,
) {
  const filteredDefaultClipNames = defaultClipNames.filter(
    (clipName) => !EXCLUDED_NAVIGATION_ROBOT_CLIP_NAMES.has(clipName),
  )

  if (
    !(typeof overrideClipName === 'string' && overrideClipName.length > 0) ||
    EXCLUDED_NAVIGATION_ROBOT_CLIP_NAMES.has(overrideClipName)
  ) {
    return [...filteredDefaultClipNames]
  }

  return [
    overrideClipName,
    ...filteredDefaultClipNames.filter((clipName) => clipName !== overrideClipName),
  ]
}

function readNavigationRobotClipOverrides(storage: Storage | null | undefined) {
  if (!storage) {
    return DEFAULT_NAVIGATION_ROBOT_CLIP_OVERRIDES
  }

  try {
    const rawValue = storage.getItem(NAVIGATION_ROBOT_CLIP_OVERRIDE_STORAGE_KEY)
    return normalizeNavigationRobotClipOverrides(rawValue ? JSON.parse(rawValue) : null)
  } catch {
    return DEFAULT_NAVIGATION_ROBOT_CLIP_OVERRIDES
  }
}

function readNavigationRobotAssetVersion(storage: Storage | null | undefined) {
  if (!storage) {
    return null
  }

  try {
    const rawValue = storage.getItem(NAVIGATION_ROBOT_ASSET_VERSION_STORAGE_KEY)
    if (!rawValue) {
      return null
    }

    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null
  } catch {
    return null
  }
}

function getNavigationRobotAssetUrl(
  storage: Storage | null | undefined,
  assetPath = NAVIGATION_ROBOT_ASSET_PATH,
) {
  const version = readNavigationRobotAssetVersion(storage)
  if (!version) {
    return assetPath
  }

  return `${assetPath}?v=${version}`
}

const ROBOT_TARGET_HEIGHT = 1.82
const TOOL_CONE_VFX_LAYER = 3
const ROBOT_ASSET_SCALE_MULTIPLIER =
  NAVIGATION_ROBOT_ASSET_PATH === '/navigation/proto_pascal_robot.glb' ? 1 / 110.16949152542374 : 1
const IDLE_TIME_SCALE = 0.5
const CLIP_BLEND_RESPONSE = 8
const CLIP_TIME_SCALE_RESPONSE = 10
const FORCED_CLIP_RELEASE_BLEND_RESPONSE = 12
const SLOW_RELEASE_CLIP_BLEND_RESPONSE_BY_NAME: Record<string, number> = {
  Jumping_Down: 8,
}
const JUMPING_DOWN_CLIP_NAME = 'Jumping_Down'
const FORCED_CLIP_VISUAL_REVEAL_DURATION_SECONDS = 1.5
const TOOL_ATTACHMENT_REVEAL_DURATION_SECONDS = FORCED_CLIP_VISUAL_REVEAL_DURATION_SECONDS
const MODEL_FORWARD_ROTATION_Y = 0
const TOOL_ASSET_PATH = '/navigation/tool-asset.glb'
const TOOL_ATTACHMENT_SCALE = 1800
const NAVIGATION_ROBOT_DEBUG_ENABLED = false
const NAVIGATION_ROBOT_VERBOSE_DEBUG_ENABLED = false
const ROBOT_DEBUG_PUBLISH_INTERVAL_MS = 100
const SHOULDER_BONE_NAMES = ['LeftShoulder', 'RightShoulder'] as const
const LEFT_SHOULDER_BONE_NAMES = [
  'LeftShoulder',
  'mixamorigLeftShoulder',
  'Shoulder_L',
  'Left_Shoulder',
] as const
const LEFT_UPPER_ARM_BONE_NAMES = ['LeftArm', 'mixamorigLeftArm', 'Arm_L', 'Left_Arm'] as const
const LEFT_ELBOW_BONE_NAMES = [
  'LeftForeArm',
  'mixamorigLeftForeArm',
  'ForeArm_L',
  'Left_ForeArm',
] as const
const LEFT_HAND_BONE_NAMES = ['LeftHand', 'mixamorigLeftHand', 'Hand_L', 'Left_Hand'] as const
const CHECKOUT_CLIP_NAME = 'Checkout_Gesture'
const CHECKOUT_LEFT_HAND_ROTATION_DEGREES = { x: -79, y: 24, z: 9 } as const
const LEFT_TOOL_OFFSET = { x: -3, y: 13.4, z: 3.8 } as const
const LEFT_TOOL_ROTATION_DEGREES = { x: -180, y: -21, z: 90 } as const
const TOOL_CONE_OVERLAY_COLOR = '#0fd6ff'
const TOOL_CONE_EDGE_GLOW_COLOR = TOOL_CONE_OVERLAY_COLOR
const TOOL_CONE_EDGE_GLOW_BRIGHTNESS = 1.24
const TOOL_CONE_EDGE_GLOW_INWARD_DIFFUSION_DEPTH = 0.19504
const TOOL_CONE_EDGE_GLOW_INWARD_GRADIENT_BEND = 0.1
const TOOL_CONE_EDGE_GLOW_OUTWARD_DIFFUSION_DEPTH = 0.02184
const TOOL_CONE_EDGE_GLOW_OUTWARD_GRADIENT_BEND = 0.09
const TOOL_CONE_EDGE_GLOW_ATTENUATION = 0.26
const TOOL_CONE_GRADIENT_BEND = 0.58
const TOOL_CONE_EXTRA_TRANSPARENCY_PERCENT = 61
const TOOL_CONE_VISIBLE_START_TIME = 1.8
const TOOL_CONE_VISIBLE_END_TIME = 3.75
const TOOL_CONE_FOLLOW_BLEND_DURATION_SECONDS = 0.55
const TOOL_CONE_FOLLOW_RELEASE_RESPONSE = 7
const TOOL_CONE_FOLLOW_FOREARM_TARGET_HEIGHT_OFFSET = 0.04
const TOOL_CONE_FOLLOW_SHOULDER_TARGET_HEIGHT_OFFSET = 0.24
const TOOL_CONE_OPACITY_SCALE = 1 - TOOL_CONE_EXTRA_TRANSPARENCY_PERCENT / 100
const TOOL_CONE_TOOL_CORNER_OFFSET = { x: -16.5, y: 4.5, z: 0 } as const
const TOOL_CONE_CAMERA_SURFACE_EPSILON = 0.035
const TOOL_CONE_TARGET_SURFACE_DEPTH_BIAS = 0.012
const TOOL_CONE_MAX_PROJECTED_HULL_VERTEX_COUNT = 9
const TOOL_CONE_EXPONENTIAL_BEND_STRENGTH_MULTIPLIER = 6
const LANDING_SETTLE_VERTICAL_SPEED_THRESHOLD_RATIO = 0.04
const LANDING_SETTLE_WINDOW_DURATION_SECONDS = 0.2
const LANDING_SETTLE_FALLBACK_PROGRESS = 0.68
const LANDING_SHOULDER_BLEND_DURATION_RATIO = 0.075
const LANDING_SHOULDER_BLEND_MIN_DURATION_SECONDS = 0.2
const TOOL_CONE_SUPPORT_SIGNS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [-1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1],
]
const LOCAL_BONE_AIM_AXIS = new Vector3(0, 1, 0)

type NavigationRobotMotionRef = MutableRefObject<{
  debugActiveClipName?: string | null
  debugForcedClipRevealProgress?: number
  debugForcedClipTime?: number | null
  debugLandingShoulderBlendWeight?: number
  debugReleasedForcedClipName?: string | null
  debugReleasedForcedClipTime?: number | null
  debugReleasedForcedWeight?: number
  debugTransitionPreview?: {
    releasedClipName: string
    releasedClipTime: number
    releasedClipWeight: number
  } | null
  forcedClip: {
    clipName: string
    holdLastFrame: boolean
    loop: 'once' | 'repeat'
    paused: boolean
    revealProgress: number
    seekTime: number | null
    timeScale: number
  } | null
  locomotion: {
    moveBlend: number
    runBlend: number
    runTimeScale: number
    walkTimeScale: number
  }
  moving: boolean
  rootMotionOffset: [number, number, number]
  visibilityRevealProgress?: number | null
}>

export type NavigationRobotToolInteractionPhase = 'delete' | 'drop' | 'pickup' | 'repair'
export type NavigationRobotMaterialDebugMode = 'auto' | 'original-only' | 'reveal-only'

type NavigationRobotProps = {
  active?: boolean
  animationPaused?: boolean
  clipNameOverrides?: Partial<NavigationRobotClipOverrideState>
  debugId?: string
  debugStateRef?: MutableRefObject<Record<string, unknown> | null> | undefined
  debugTransitionPreview?: {
    releasedClipName: string
    releasedClipTime: number
    releasedClipWeight: number
  } | null
  forcedClipPlayback?: {
    clipName: string
    holdLastFrame?: boolean
    loop?: 'once' | 'repeat'
    playbackToken?: number | string
    revealFromStart?: boolean
    stabilizeRootMotion?: boolean
    timeScale?: number
  } | null
  forcedClipVisualOffset?: [number, number, number] | null
  hoverOffset: number
  motionRef: NavigationRobotMotionRef
  onReady?: (() => void) | undefined
  onSceneReady?: ((scene: Group | null) => void) | undefined
  onWarmupReadyChange?: ((ready: boolean) => void) | undefined
  materialDebugMode?: NavigationRobotMaterialDebugMode
  skinnedMeshVisibilityOverride?: boolean | null
  staticMeshVisibilityOverride?: boolean | null
  showToolAttachments?: boolean
  toolConeColor?: string | null
  toolCarryItemId?: string | null
  toolCarryItemIdRef?: MutableRefObject<string | null> | undefined
  toolInteractionPhaseRef?: MutableRefObject<NavigationRobotToolInteractionPhase | null> | undefined
  toolInteractionTargetItemIdRef?: MutableRefObject<string | null> | undefined
}

type RobotTransform = {
  offset: [number, number, number]
  scale: number
}

type AnimationBlendState = {
  idleWeight: number
  runTimeScale: number
  runWeight: number
  walkTimeScale: number
  walkWeight: number
}

type DebugBoneSample = {
  bone: Object3D
  name: string
  previousPosition: Vector3
  previousQuaternion: Quaternion
}

type RevealUniform = {
  value: number
}

type RevealMaterialBinding = {
  material: Material & {
    alphaTest: number
    alphaTestNode?: unknown
    customProgramCacheKey?: () => string
    maskNode?: unknown
    needsUpdate: boolean
    onBeforeCompile?:
      | ((shader: {
          fragmentShader: string
          uniforms: Record<string, { value: number }>
          vertexShader: string
        }) => void)
      | undefined
    opacityNode?: unknown
    transparent: boolean
  }
  uniforms: {
    revealFeather: RevealUniform
    revealMaxY: RevealUniform
    revealMinY: RevealUniform
    revealProgress: RevealUniform
  }
  webgpuUniforms: {
    revealFeather: RevealUniform
    revealMaxY: RevealUniform
    revealMinY: RevealUniform
    revealProgress: RevealUniform
  }
}

type RevealMaterialEntry = {
  bindings: RevealMaterialBinding[]
  mesh: Mesh
  originalMaterial: Material | Material[]
  revealMaterial: Material | Material[]
}

function collectMeshList(root: Object3D) {
  const meshes: Mesh[] = []
  root.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh) {
      meshes.push(mesh)
    }
  })
  return meshes
}

function hasAncestorNamed(object: Object3D | null, name: string) {
  let current: Object3D | null = object
  while (current) {
    if (current.name === name) {
      return true
    }
    current = current.parent
  }
  return false
}

function disableFrustumCulling(root: Object3D) {
  root.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh) {
      mesh.frustumCulled = false
    }
  })
}

function applyWarmupRevealMaterials(root: Object3D, entries: RevealMaterialEntry[]) {
  const meshes = collectMeshList(root)
  const count = Math.min(meshes.length, entries.length)
  for (let index = 0; index < count; index += 1) {
    const mesh = meshes[index]
    const entry = entries[index]
    if (mesh && entry) {
      mesh.material = entry.revealMaterial
    }
  }
}

type ShoulderBoneName = (typeof SHOULDER_BONE_NAMES)[number]

type ShoulderPoseTargets = Partial<Record<ShoulderBoneName, Quaternion>>

type RuntimePlanarRootMotionClip = {
  landingSettleTime: number | null
  landingShoulderBlendEndTime: number | null
  playbackClip: AnimationClip
  samplePlanarLocalOffset: (time: number, target: Vector3) => Vector3
}

type ToolOffset = {
  x: number
  y: number
  z: number
}

type ToolRotationDegrees = {
  x: number
  y: number
  z: number
}

type ProjectedHullCandidate = {
  cameraSnapped?: boolean
  cameraSurfaceDistanceDelta?: number | null
  cameraSurfaceMeshName?: string | null
  cameraSurfacePoint?: [number, number, number] | null
  cameraSurfaceRelation?: 'no-hit' | 'occluded' | 'visible'
  isApex: boolean
  localPoint: Vector3
  projectedPoint: Vector2
  sourceMeshName: string | null
  sourceMeshVisible: boolean | null
  supportIndex: number | null
  worldPoint: Vector3
}

type ToolConeSupportPointDiagnostic = {
  cameraSnapped?: boolean
  cameraSurfaceDistanceDelta?: number | null
  cameraSurfaceMeshName?: string | null
  cameraSurfacePoint?: [number, number, number] | null
  cameraSurfaceRelation?: 'no-hit' | 'occluded' | 'visible'
  sourceMeshName: string | null
  sourceMeshVisible: boolean
}

type FrozenToolConeHullPoint = {
  cameraSnapped: boolean
  cameraSurfaceDistanceDelta: number | null
  cameraSurfaceMeshName: string | null
  cameraSurfacePoint: [number, number, number] | null
  cameraSurfaceRelation: 'no-hit' | 'occluded' | 'visible' | null
  sourceMeshName: string | null
  sourceMeshVisible: boolean | null
  supportIndex: number | null
  targetLocalPoint: Vector3
  worldPoint: Vector3
}

type ToolConeRenderable = {
  group: Group
  inwardGlowMesh: Mesh
  inwardGlowPositionAttribute: Float32BufferAttribute
  mainGeometry: BufferGeometry
  mainMesh: Mesh
  mainPositionAttribute: Float32BufferAttribute
  mainUvAttribute: Float32BufferAttribute
  outlineMesh: LineSegments
  outlinePositionAttribute: Float32BufferAttribute
  outwardGlowMesh: Mesh
  outwardGlowPositionAttribute: Float32BufferAttribute
}

const ROOT_MOTION_BONE_CANDIDATE_NAMES = ['Hips', 'hips', 'mixamorigHips'] as const

function degreesToRadians(rotation: ToolRotationDegrees): [number, number, number] {
  return [
    MathUtils.degToRad(rotation.x),
    MathUtils.degToRad(rotation.y),
    MathUtils.degToRad(rotation.z),
  ]
}

function createToolRenderable(
  toolScene: Group,
  name: string,
  initialOffset: ToolOffset,
  initialRotationDegrees: ToolRotationDegrees,
) {
  const toolRoot = new Group()
  const toolAttachment = toolScene.clone(true) as Group
  const toolBounds = new Box3()
  const toolCenter = new Vector3()

  toolRoot.name = `${name}-root`
  toolRoot.position.set(initialOffset.x, initialOffset.y, initialOffset.z)
  toolRoot.rotation.set(...degreesToRadians(initialRotationDegrees))

  toolAttachment.name = name
  toolAttachment.scale.setScalar(TOOL_ATTACHMENT_SCALE)
  toolAttachment.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) {
      return
    }

    mesh.castShadow = true
    mesh.receiveShadow = true
  })

  toolBounds.setFromObject(toolAttachment)
  toolBounds.getCenter(toolCenter)
  toolAttachment.position.set(-toolCenter.x, -toolCenter.y, -toolCenter.z)
  toolRoot.add(toolAttachment)

  return toolRoot
}

function cross2D(origin: Vector2, pointA: Vector2, pointB: Vector2) {
  return (
    (pointA.x - origin.x) * (pointB.y - origin.y) - (pointA.y - origin.y) * (pointB.x - origin.x)
  )
}

function computeProjectedHull(candidates: ProjectedHullCandidate[]) {
  if (candidates.length < 3) {
    return candidates
  }

  const sorted = [...candidates].sort((candidateA, candidateB) => {
    if (Math.abs(candidateA.projectedPoint.x - candidateB.projectedPoint.x) > 1e-6) {
      return candidateA.projectedPoint.x - candidateB.projectedPoint.x
    }
    return candidateA.projectedPoint.y - candidateB.projectedPoint.y
  })
  const uniqueCandidates = sorted.filter((candidate, index) => {
    if (index === 0) {
      return true
    }
    const previousCandidate = sorted[index - 1]
    if (!previousCandidate) {
      return true
    }
    return (
      Math.abs(candidate.projectedPoint.x - previousCandidate.projectedPoint.x) > 1e-6 ||
      Math.abs(candidate.projectedPoint.y - previousCandidate.projectedPoint.y) > 1e-6
    )
  })

  if (uniqueCandidates.length < 3) {
    return uniqueCandidates
  }

  const lowerHull: ProjectedHullCandidate[] = []
  for (const candidate of uniqueCandidates) {
    while (lowerHull.length >= 2) {
      const previousCandidate = lowerHull[lowerHull.length - 1]
      const previousPreviousCandidate = lowerHull[lowerHull.length - 2]
      if (!previousCandidate || !previousPreviousCandidate) {
        break
      }
      if (
        cross2D(
          previousPreviousCandidate.projectedPoint,
          previousCandidate.projectedPoint,
          candidate.projectedPoint,
        ) > 0
      ) {
        break
      }
      lowerHull.pop()
    }
    lowerHull.push(candidate)
  }

  const upperHull: ProjectedHullCandidate[] = []
  for (let index = uniqueCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = uniqueCandidates[index]
    if (!candidate) {
      continue
    }
    while (upperHull.length >= 2) {
      const previousCandidate = upperHull[upperHull.length - 1]
      const previousPreviousCandidate = upperHull[upperHull.length - 2]
      if (!previousCandidate || !previousPreviousCandidate) {
        break
      }
      if (
        cross2D(
          previousPreviousCandidate.projectedPoint,
          previousCandidate.projectedPoint,
          candidate.projectedPoint,
        ) > 0
      ) {
        break
      }
      upperHull.pop()
    }
    upperHull.push(candidate)
  }

  lowerHull.pop()
  upperHull.pop()
  return [...lowerHull, ...upperHull]
}

function reorderHullFromApex(projectedHull: ProjectedHullCandidate[]) {
  const apexIndex = projectedHull.findIndex((candidate) => candidate.isApex)
  if (apexIndex <= 0) {
    return projectedHull
  }
  return [...projectedHull.slice(apexIndex), ...projectedHull.slice(0, apexIndex)]
}

function createBendFadeNode(bendValue: number) {
  const bendNode: any = float(Math.max(bendValue, 0))
  const bendMix: any = smoothstep(float(0), float(0.03), bendNode)
  const strength: any = bendNode.mul(float(TOOL_CONE_EXPONENTIAL_BEND_STRENGTH_MULTIPLIER))
  const gradientProgress: any = uv().x
  const linearFade: any = gradientProgress.oneMinus()
  const expStrength: any = (float(-1).mul(strength) as any).exp()
  const expFade: any = (float(-1).mul(strength).mul(gradientProgress) as any)
    .exp()
    .sub(expStrength)
    .div(float(1).sub(expStrength).add(float(1e-5)))
  return linearFade.mul(float(1).sub(bendMix)).add(expFade.mul(bendMix))
}

function hasToolConeTargetExclusion(target: Object3D | null) {
  let current: Object3D | null = target
  while (current) {
    if (
      typeof current.userData === 'object' &&
      current.userData !== null &&
      current.userData.pascalExcludeFromToolConeTarget === true
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function isObjectVisibleInHierarchy(target: Object3D | null) {
  let current: Object3D | null = target
  while (current) {
    if (!current.visible) {
      return false
    }
    current = current.parent
  }
  return true
}

function vector2ToTuple(value: Vector2) {
  return [value.x, value.y] as [number, number]
}

function vector3ToTuple(value: Vector3) {
  return [value.x, value.y, value.z] as [number, number, number]
}

function getToolConeTargetSurfaceHit(
  target: Object3D,
  worldPoint: Vector3,
  cameraPosition: Vector3,
  raycaster: Raycaster,
  scratchDirection: Vector3,
) {
  scratchDirection.copy(worldPoint).sub(cameraPosition)
  const targetDistance = scratchDirection.length()
  if (!(targetDistance > 1e-5)) {
    return null
  }

  scratchDirection.multiplyScalar(1 / targetDistance)
  raycaster.set(cameraPosition, scratchDirection)
  raycaster.near = 0.001
  raycaster.far = targetDistance + 0.25
  const hit = raycaster
    .intersectObject(target, true)
    .find(
      (intersection) =>
        !hasToolConeTargetExclusion(intersection.object) &&
        isObjectVisibleInHierarchy(intersection.object),
    )
  if (!hit) {
    return {
      relation: 'no-hit' as const,
      surfaceDistanceDelta: null,
      surfaceMeshName: null,
      surfaceNormalWorld: null,
      surfacePoint: null,
    }
  }

  const surfaceDistanceDelta = Math.abs(targetDistance - hit.distance)
  const surfaceNormalWorld = hit.face?.normal
    ? hit.face.normal
        .clone()
        .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize()
    : null
  return {
    relation:
      surfaceDistanceDelta <= TOOL_CONE_CAMERA_SURFACE_EPSILON
        ? ('visible' as const)
        : ('occluded' as const),
    surfaceDistanceDelta,
    surfaceMeshName: hit.object.name || null,
    surfaceNormalWorld,
    surfacePoint: hit.point,
  }
}

function collectTargetSupportPoints(
  target: Object3D,
  outputPoints: Vector3[],
  scratchPoint: Vector3,
  scratchScores: number[],
  outputDiagnostics?: (ToolConeSupportPointDiagnostic | null)[],
  cameraPosition?: Vector3,
  surfaceRaycaster?: Raycaster,
  surfaceRayDirection?: Vector3,
) {
  scratchScores.fill(-Infinity)
  outputDiagnostics?.fill(null)
  target.updateWorldMatrix(true, true)

  target.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry || hasToolConeTargetExclusion(mesh)) {
      return
    }

    const positionAttribute = mesh.geometry.getAttribute('position')
    if (!positionAttribute) {
      return
    }

    for (let index = 0; index < positionAttribute.count; index += 1) {
      scratchPoint.fromBufferAttribute(positionAttribute, index)
      mesh.localToWorld(scratchPoint)

      for (let supportIndex = 0; supportIndex < TOOL_CONE_SUPPORT_SIGNS.length; supportIndex += 1) {
        const supportSigns = TOOL_CONE_SUPPORT_SIGNS[supportIndex]
        if (!supportSigns) {
          continue
        }
        const [signX, signY, signZ] = supportSigns
        const score = scratchPoint.x * signX + scratchPoint.y * signY + scratchPoint.z * signZ

        if (score > (scratchScores[supportIndex] ?? Number.NEGATIVE_INFINITY)) {
          scratchScores[supportIndex] = score
          outputPoints[supportIndex]?.copy(scratchPoint)
          if (outputDiagnostics) {
            outputDiagnostics[supportIndex] = {
              sourceMeshName: mesh.name || null,
              sourceMeshVisible: isObjectVisibleInHierarchy(mesh),
            }
          }
        }
      }
    }
  })

  if (cameraPosition && surfaceRaycaster && surfaceRayDirection) {
    for (let supportIndex = 0; supportIndex < outputPoints.length; supportIndex += 1) {
      const supportPoint = outputPoints[supportIndex]
      if (!supportPoint) {
        continue
      }

      const surfaceHit = getToolConeTargetSurfaceHit(
        target,
        supportPoint,
        cameraPosition,
        surfaceRaycaster,
        surfaceRayDirection,
      )
      if (!surfaceHit) {
        continue
      }

      const diagnostic = outputDiagnostics?.[supportIndex]
      if (surfaceHit.surfacePoint) {
        supportPoint.copy(surfaceHit.surfacePoint)
        supportPoint.addScaledVector(surfaceRayDirection, -TOOL_CONE_TARGET_SURFACE_DEPTH_BIAS)
      }
      if (diagnostic) {
        diagnostic.cameraSnapped = Boolean(surfaceHit.surfacePoint)
        diagnostic.cameraSurfaceDistanceDelta = surfaceHit.surfaceDistanceDelta
        diagnostic.cameraSurfaceMeshName = surfaceHit.surfaceMeshName
        diagnostic.cameraSurfacePoint = surfaceHit.surfacePoint
          ? vector3ToTuple(surfaceHit.surfacePoint)
          : null
        diagnostic.cameraSurfaceRelation = surfaceHit.relation
      }
    }
  }

  return scratchScores.every((score) => Number.isFinite(score))
}

function applyLiveTransformToSceneObject(nodeId: string, target: Object3D) {
  const liveTransform = useLiveTransforms.getState().get(nodeId)
  if (!liveTransform) {
    return
  }

  target.position.set(
    liveTransform.position[0],
    liveTransform.position[1],
    liveTransform.position[2],
  )
  target.rotation.y = liveTransform.rotation
  target.updateWorldMatrix(true, true)
}

function createToolConeRenderable(
  name: string,
  coneMaterial: MeshBasicNodeMaterial,
  outlineMaterial: LineBasicMaterial,
  inwardGlowMaterial: MeshBasicNodeMaterial,
  outwardGlowMaterial: MeshBasicNodeMaterial,
): ToolConeRenderable {
  const group = new Group()
  group.name = `${name}-root`
  group.layers.set(TOOL_CONE_VFX_LAYER)
  group.userData.pascalExcludeFromToolReveal = true

  const mainGeometry = new BufferGeometry()
  const mainPositionAttribute = new Float32BufferAttribute(
    new Array(TOOL_CONE_MAX_PROJECTED_HULL_VERTEX_COUNT * 3).fill(0),
    3,
  )
  const mainUvAttribute = new Float32BufferAttribute(
    new Array(TOOL_CONE_MAX_PROJECTED_HULL_VERTEX_COUNT * 2).fill(0),
    2,
  )
  const indices: number[] = []
  for (let index = 1; index < TOOL_CONE_MAX_PROJECTED_HULL_VERTEX_COUNT - 1; index += 1) {
    indices.push(0, index, index + 1)
  }
  mainGeometry.setAttribute('position', mainPositionAttribute)
  mainGeometry.setAttribute('uv', mainUvAttribute)
  mainGeometry.setIndex(indices)
  mainGeometry.setDrawRange(0, 0)
  mainGeometry.computeVertexNormals()

  const mainMesh = new Mesh(mainGeometry, coneMaterial)
  mainMesh.castShadow = false
  mainMesh.frustumCulled = false
  mainMesh.layers.set(TOOL_CONE_VFX_LAYER)
  mainMesh.receiveShadow = false
  mainMesh.renderOrder = 50
  mainMesh.userData.pascalExcludeFromOutline = true
  mainMesh.userData.pascalExcludeFromToolReveal = true

  const outlineGeometry = new BufferGeometry()
  const outlinePositionAttribute = new Float32BufferAttribute(
    new Array(TOOL_CONE_MAX_PROJECTED_HULL_VERTEX_COUNT * 2 * 3).fill(0),
    3,
  )
  outlineGeometry.setAttribute('position', outlinePositionAttribute)
  outlineGeometry.setDrawRange(0, 0)
  const outlineMesh = new LineSegments(outlineGeometry, outlineMaterial)
  outlineMesh.frustumCulled = false
  outlineMesh.layers.set(TOOL_CONE_VFX_LAYER)
  outlineMesh.renderOrder = 51
  outlineMesh.userData.pascalExcludeFromToolReveal = true

  const inwardGlowGeometry = new BufferGeometry()
  const maxEdgeCount = TOOL_CONE_MAX_PROJECTED_HULL_VERTEX_COUNT
  const inwardGlowPositionAttribute = new Float32BufferAttribute(
    new Array(maxEdgeCount * 6 * 3).fill(0),
    3,
  )
  const inwardGlowUvValues: number[] = []
  for (let edgeIndex = 0; edgeIndex < maxEdgeCount; edgeIndex += 1) {
    inwardGlowUvValues.push(0, 0, 0, 1, 1, 1)
    inwardGlowUvValues.push(0, 0, 1, 1, 1, 0)
  }
  inwardGlowGeometry.setAttribute('position', inwardGlowPositionAttribute)
  inwardGlowGeometry.setAttribute('uv', new Float32BufferAttribute(inwardGlowUvValues, 2))
  inwardGlowGeometry.setDrawRange(0, 0)
  const inwardGlowMesh = new Mesh(inwardGlowGeometry, inwardGlowMaterial)
  inwardGlowMesh.castShadow = false
  inwardGlowMesh.frustumCulled = false
  inwardGlowMesh.layers.set(TOOL_CONE_VFX_LAYER)
  inwardGlowMesh.receiveShadow = false
  inwardGlowMesh.renderOrder = 52
  inwardGlowMesh.userData.pascalExcludeFromOutline = true
  inwardGlowMesh.userData.pascalExcludeFromToolReveal = true

  const outwardGlowGeometry = new BufferGeometry()
  const outwardGlowPositionAttribute = new Float32BufferAttribute(
    new Array(maxEdgeCount * 6 * 3).fill(0),
    3,
  )
  const outwardGlowUvValues: number[] = []
  for (let edgeIndex = 0; edgeIndex < maxEdgeCount; edgeIndex += 1) {
    outwardGlowUvValues.push(0, 0, 1, 1, 0, 1)
    outwardGlowUvValues.push(0, 0, 1, 0, 1, 1)
  }
  outwardGlowGeometry.setAttribute('position', outwardGlowPositionAttribute)
  outwardGlowGeometry.setAttribute('uv', new Float32BufferAttribute(outwardGlowUvValues, 2))
  outwardGlowGeometry.setDrawRange(0, 0)
  const outwardGlowMesh = new Mesh(outwardGlowGeometry, outwardGlowMaterial)
  outwardGlowMesh.castShadow = false
  outwardGlowMesh.frustumCulled = false
  outwardGlowMesh.layers.set(TOOL_CONE_VFX_LAYER)
  outwardGlowMesh.receiveShadow = false
  outwardGlowMesh.renderOrder = 53
  outwardGlowMesh.userData.pascalExcludeFromOutline = true
  outwardGlowMesh.userData.pascalExcludeFromToolReveal = true

  group.add(mainMesh)
  group.add(outlineMesh)
  group.add(inwardGlowMesh)
  group.add(outwardGlowMesh)

  return {
    group,
    inwardGlowMesh,
    inwardGlowPositionAttribute,
    mainGeometry,
    mainMesh,
    mainPositionAttribute,
    mainUvAttribute,
    outlineMesh,
    outlinePositionAttribute,
    outwardGlowMesh,
    outwardGlowPositionAttribute,
  }
}

function findRootMotionBone(root: Object3D): Object3D | null {
  for (const candidateName of ROOT_MOTION_BONE_CANDIDATE_NAMES) {
    let matchedBone: Object3D | null = null
    root.traverse((child) => {
      if (!matchedBone && 'isBone' in child && child.isBone && child.name === candidateName) {
        matchedBone = child
      }
    })
    if (matchedBone) {
      return matchedBone
    }
  }

  let firstBone: Object3D | null = null
  root.traverse((child) => {
    if (!firstBone && 'isBone' in child && child.isBone) {
      firstBone = child
    }
  })
  return firstBone
}

let lastRobotDebugPublishAt = 0

function shouldWriteRobotDebugState(debugId: string | undefined) {
  return Boolean(debugId) || NAVIGATION_ROBOT_DEBUG_ENABLED
}

function writeRobotDebugState(
  _debugId: string | undefined,
  debugStateRef: MutableRefObject<Record<string, unknown> | null> | undefined,
  debugPayload: Record<string, unknown>,
) {
  if (debugStateRef) {
    debugStateRef.current = debugPayload
  }
}

function getCurrentRootMotionOffset(
  rootGroup: Group | null,
  rootMotionBone: Object3D | null,
  baselineScenePosition: Vector3 | null,
  baselineWorld: Vector3,
  currentWorld: Vector3,
  target: Vector3,
) {
  if (!(rootGroup && rootMotionBone && baselineScenePosition)) {
    return target.set(0, 0, 0)
  }

  const currentRootMotionWorld = rootMotionBone.getWorldPosition(currentWorld)
  const baselineRootMotionWorld = rootGroup.localToWorld(baselineWorld.copy(baselineScenePosition))
  return target.copy(currentRootMotionWorld).sub(baselineRootMotionWorld)
}

function findRootMotionTrack(clip: AnimationClip) {
  for (const candidateName of ROOT_MOTION_BONE_CANDIDATE_NAMES) {
    const candidateTrack = clip.tracks.find(
      (track) => track.name === `${candidateName}.position` && track.getValueSize() === 3,
    )
    if (candidateTrack) {
      return candidateTrack as VectorKeyframeTrack
    }
  }

  return null
}

function findAttachmentTargetByTokens(
  root: Group,
  boneNames: readonly string[],
  fuzzyTokens: readonly string[],
) {
  for (const boneName of boneNames) {
    const exactMatch = root.getObjectByName(boneName)
    if (exactMatch) {
      return exactMatch
    }
  }

  let fuzzyMatch: Object3D | null = null
  root.traverse((child) => {
    if (fuzzyMatch) {
      return
    }

    const normalizedName = child.name.replaceAll(/[^a-z]/gi, '').toLowerCase()
    if (fuzzyTokens.some((token) => normalizedName.includes(token))) {
      fuzzyMatch = child
    }
  })

  return fuzzyMatch
}

function findBoneQuaternionTrack(clip: AnimationClip, boneName: ShoulderBoneName) {
  const candidateTrack = clip.tracks.find(
    (track) => track.name === `${boneName}.quaternion` && track.getValueSize() === 4,
  )
  return candidateTrack ?? null
}

function readTrackFirstQuaternion(
  track: ReturnType<typeof findBoneQuaternionTrack>,
  target: Quaternion,
) {
  if (!track) {
    return target.identity()
  }

  return target
    .set(track.values[0] ?? 0, track.values[1] ?? 0, track.values[2] ?? 0, track.values[3] ?? 1)
    .normalize()
}

function findLandingSettleTime(rootMotionTrack: VectorKeyframeTrack, clipDuration: number) {
  const times = rootMotionTrack.times
  const values = rootMotionTrack.values
  if (times.length < 3 || values.length < 9) {
    return null
  }

  const searchStartFrameIndex = Math.max(1, Math.floor(times.length * 0.2))
  let minimumYFrameIndex = searchStartFrameIndex
  let minimumY = values[minimumYFrameIndex * 3 + 1] ?? 0
  let maximumY = values[1] ?? minimumY

  for (let frameIndex = 0; frameIndex < times.length; frameIndex += 1) {
    const y = values[frameIndex * 3 + 1] ?? minimumY
    maximumY = Math.max(maximumY, y)
    if (frameIndex >= searchStartFrameIndex && y < minimumY) {
      minimumY = y
      minimumYFrameIndex = frameIndex
    }
  }

  const verticalRange = Math.max(1e-3, maximumY - minimumY)
  const settleSpeedThreshold = Math.max(
    1,
    verticalRange * LANDING_SETTLE_VERTICAL_SPEED_THRESHOLD_RATIO,
  )
  const settleWindowDuration = Math.min(
    LANDING_SETTLE_WINDOW_DURATION_SECONDS,
    Math.max(0.12, clipDuration * 0.08),
  )

  for (
    let startFrameIndex = minimumYFrameIndex + 1;
    startFrameIndex < times.length;
    startFrameIndex += 1
  ) {
    let endFrameIndex = startFrameIndex
    while (
      endFrameIndex + 1 < times.length &&
      (times[endFrameIndex] ?? 0) - (times[startFrameIndex] ?? 0) < settleWindowDuration
    ) {
      endFrameIndex += 1
    }

    if ((times[endFrameIndex] ?? 0) - (times[startFrameIndex] ?? 0) < settleWindowDuration) {
      break
    }

    let stable = true
    for (let frameIndex = startFrameIndex; frameIndex <= endFrameIndex; frameIndex += 1) {
      const previousFrameIndex = Math.max(0, frameIndex - 1)
      const currentTime = times[frameIndex] ?? 0
      const previousTime = times[previousFrameIndex] ?? currentTime
      const currentY = values[frameIndex * 3 + 1] ?? minimumY
      const previousY = values[previousFrameIndex * 3 + 1] ?? currentY
      const verticalSpeed = Math.abs(
        (currentY - previousY) / Math.max(1e-6, currentTime - previousTime),
      )
      if (verticalSpeed > settleSpeedThreshold) {
        stable = false
        break
      }
    }

    if (stable) {
      return Math.min(clipDuration, times[startFrameIndex] ?? clipDuration)
    }
  }

  return Math.min(
    clipDuration,
    Math.max(times[minimumYFrameIndex] ?? 0, clipDuration * LANDING_SETTLE_FALLBACK_PROGRESS),
  )
}

function getLandingShoulderBlendWeight(
  runtimeClip: RuntimePlanarRootMotionClip | null,
  clipTime: number,
) {
  if (
    !runtimeClip ||
    runtimeClip.landingSettleTime == null ||
    runtimeClip.landingShoulderBlendEndTime == null ||
    runtimeClip.landingShoulderBlendEndTime <= runtimeClip.landingSettleTime
  ) {
    return 0
  }

  return MathUtils.smoothstep(
    clipTime,
    runtimeClip.landingSettleTime,
    runtimeClip.landingShoulderBlendEndTime,
  )
}

function getToolConeFollowBlend(toolInteractionClipTime: number | null, hasCarryTarget: boolean) {
  if (toolInteractionClipTime === null) {
    return hasCarryTarget ? 1 : 0
  }

  return MathUtils.smoothstep(
    toolInteractionClipTime,
    TOOL_CONE_VISIBLE_END_TIME,
    TOOL_CONE_VISIBLE_END_TIME + TOOL_CONE_FOLLOW_BLEND_DURATION_SECONDS,
  )
}

function shouldShowToolConeOverlay(
  toolInteractionClipTime: number | null,
  hasCarryTarget: boolean,
) {
  if (toolInteractionClipTime !== null) {
    return (
      hasCarryTarget ||
      (toolInteractionClipTime >= TOOL_CONE_VISIBLE_START_TIME &&
        toolInteractionClipTime <= TOOL_CONE_VISIBLE_END_TIME)
    )
  }

  return hasCarryTarget
}

function shouldContinueToolConeCarry(
  toolInteractionPhase: NavigationRobotToolInteractionPhase | null,
  toolInteractionClipTime: number | null,
  hasCarryTarget: boolean,
) {
  if (!hasCarryTarget) {
    return false
  }

  if (toolInteractionPhase === 'pickup') {
    return true
  }

  if (toolInteractionPhase === 'drop') {
    return true
  }

  return false
}

function getForcedClipHoldTime(
  clipName: string,
  clipDuration: number,
  runtimeClip: RuntimePlanarRootMotionClip | null,
) {
  return clipDuration
}

function buildRuntimePlanarRootMotionClip(clip: AnimationClip): RuntimePlanarRootMotionClip | null {
  const rootMotionTrack = findRootMotionTrack(clip)
  if (!rootMotionTrack) {
    return null
  }

  const landingSettleTime =
    clip.name === JUMPING_DOWN_CLIP_NAME
      ? findLandingSettleTime(rootMotionTrack, clip.duration)
      : null
  const landingShoulderBlendEndTime =
    landingSettleTime == null
      ? null
      : Math.min(
          clip.duration,
          landingSettleTime +
            Math.max(
              LANDING_SHOULDER_BLEND_MIN_DURATION_SECONDS,
              clip.duration * LANDING_SHOULDER_BLEND_DURATION_RATIO,
            ),
        )

  const baseX = rootMotionTrack.values[0] ?? 0
  const baseZ = rootMotionTrack.values[2] ?? 0
  const flattenedRootMotionTrack = rootMotionTrack.clone() as VectorKeyframeTrack
  const flattenedValues = flattenedRootMotionTrack.values.slice()

  for (let valueIndex = 0; valueIndex < flattenedValues.length; valueIndex += 3) {
    flattenedValues[valueIndex] = baseX
    flattenedValues[valueIndex + 2] = baseZ
  }

  flattenedRootMotionTrack.values = flattenedValues

  const playbackClip = clip.clone()
  playbackClip.tracks = clip.tracks.map((track) =>
    track === rootMotionTrack ? flattenedRootMotionTrack : track.clone(),
  )

  return {
    landingSettleTime,
    landingShoulderBlendEndTime,
    playbackClip,
    samplePlanarLocalOffset: (time, target) => {
      const clampedTime = MathUtils.clamp(time, 0, clip.duration)
      const times = rootMotionTrack.times
      const values = rootMotionTrack.values
      const lastFrameIndex = Math.max(0, times.length - 1)

      if (times.length <= 1 || clampedTime <= (times[0] ?? 0)) {
        return target.set((values[0] ?? baseX) - baseX, 0, (values[2] ?? baseZ) - baseZ)
      }

      if (clampedTime >= (times[lastFrameIndex] ?? clip.duration)) {
        const valueIndex = lastFrameIndex * 3
        return target.set(
          (values[valueIndex] ?? baseX) - baseX,
          0,
          (values[valueIndex + 2] ?? baseZ) - baseZ,
        )
      }

      let upperFrameIndex = 1
      while (
        upperFrameIndex < times.length &&
        (times[upperFrameIndex] ?? clip.duration) < clampedTime
      ) {
        upperFrameIndex += 1
      }

      const lowerFrameIndex = Math.max(0, upperFrameIndex - 1)
      const lowerTime = times[lowerFrameIndex] ?? 0
      const upperTime = times[upperFrameIndex] ?? lowerTime
      const blend =
        upperTime > lowerTime
          ? MathUtils.clamp((clampedTime - lowerTime) / (upperTime - lowerTime), 0, 1)
          : 0
      const lowerValueIndex = lowerFrameIndex * 3
      const upperValueIndex = upperFrameIndex * 3
      return target.set(
        MathUtils.lerp(values[lowerValueIndex] ?? baseX, values[upperValueIndex] ?? baseX, blend) -
          baseX,
        0,
        MathUtils.lerp(
          values[lowerValueIndex + 2] ?? baseZ,
          values[upperValueIndex + 2] ?? baseZ,
          blend,
        ) - baseZ,
      )
    },
  }
}

function getRobotTransform(scene: Group, hoverOffset: number): RobotTransform {
  const bounds = new Box3().setFromObject(scene)
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  const normalizedScale = size.y > Number.EPSILON ? ROBOT_TARGET_HEIGHT / size.y : 1
  const scale = normalizedScale * ROBOT_ASSET_SCALE_MULTIPLIER

  return {
    offset: [-center.x * scale, -hoverOffset - bounds.min.y * scale, -center.z * scale],
    scale,
  }
}

function getFirstAvailableAction(
  actions: Partial<Record<string, AnimationAction | null | undefined>>,
  clipNames: readonly string[],
) {
  return clipNames.map((clipName) => actions[clipName]).find((action) => action != null) ?? null
}

function getUniqueActions(actions: Array<AnimationAction | null | undefined>): AnimationAction[] {
  return [...new Set(actions.filter((action): action is AnimationAction => Boolean(action)))]
}

function syncActionPhase(sourceAction: AnimationAction, targetAction: AnimationAction) {
  const sourceDuration = sourceAction.getClip().duration
  const targetDuration = targetAction.getClip().duration
  if (!(sourceDuration > Number.EPSILON && targetDuration > Number.EPSILON)) {
    return
  }

  const sourcePhase =
    (((sourceAction.time % sourceDuration) + sourceDuration) % sourceDuration) / sourceDuration
  targetAction.time = sourcePhase * targetDuration
}

function applyShoulderPoseTargets(
  shoulderBones: Partial<Record<ShoulderBoneName, Object3D>>,
  shoulderTargets: ShoulderPoseTargets,
  weight: number,
) {
  const clampedWeight = MathUtils.clamp(weight, 0, 1)
  if (clampedWeight <= 1e-3) {
    return
  }

  for (const shoulderBoneName of SHOULDER_BONE_NAMES) {
    const shoulderBone = shoulderBones[shoulderBoneName]
    const targetQuaternion = shoulderTargets[shoulderBoneName]
    if (!(shoulderBone && targetQuaternion)) {
      continue
    }

    shoulderBone.quaternion.slerp(targetQuaternion, clampedWeight)
  }
}

function getObjectWorldCenter(target: Object3D | null, bounds: Box3, output: Vector3) {
  if (!target) {
    return null
  }

  bounds.setFromObject(target)
  if (bounds.isEmpty()) {
    return null
  }

  return bounds.getCenter(output)
}

function aimBoneYAxisTowardWorldTarget(
  bone: Object3D | null,
  targetWorld: Vector3,
  weight: number,
  boneWorldPosition: Vector3,
  targetDirectionWorld: Vector3,
  parentWorldQuaternion: Quaternion,
  targetDirectionParent: Vector3,
  targetLocalQuaternion: Quaternion,
) {
  if (!(bone && weight > 1e-4)) {
    return
  }

  bone.getWorldPosition(boneWorldPosition)
  targetDirectionWorld.copy(targetWorld).sub(boneWorldPosition)
  if (targetDirectionWorld.lengthSq() <= 1e-8) {
    return
  }

  targetDirectionWorld.normalize()
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentWorldQuaternion).invert()
    targetDirectionParent.copy(targetDirectionWorld).applyQuaternion(parentWorldQuaternion)
  } else {
    targetDirectionParent.copy(targetDirectionWorld)
  }

  if (targetDirectionParent.lengthSq() <= 1e-8) {
    return
  }

  targetDirectionParent.normalize()
  targetLocalQuaternion.setFromUnitVectors(LOCAL_BONE_AIM_AXIS, targetDirectionParent)
  bone.quaternion.slerp(targetLocalQuaternion, MathUtils.clamp(weight, 0, 1))
  bone.updateMatrixWorld(true)
}

function accumulateActionTarget(
  targets: Map<
    AnimationAction,
    { timeScaleSum: number; weight: number; weightedTimeScale: number }
  >,
  action: AnimationAction | null,
  weight: number,
  timeScale: number,
) {
  if (!action) {
    return
  }

  const nextWeight = MathUtils.clamp(weight, 0, 1)
  const currentTarget = targets.get(action)
  if (!currentTarget) {
    targets.set(action, {
      timeScaleSum: nextWeight > Number.EPSILON ? timeScale * nextWeight : 0,
      weight: nextWeight,
      weightedTimeScale: nextWeight,
    })
    return
  }

  currentTarget.weight += nextWeight
  currentTarget.timeScaleSum += nextWeight > Number.EPSILON ? timeScale * nextWeight : 0
  currentTarget.weightedTimeScale += nextWeight
}

function setActionInactive(action: AnimationAction) {
  action.setEffectiveWeight(0)
  action.enabled = false
  action.paused = true
}

function setActionActive(action: AnimationAction, weight: number, timeScale: number) {
  action.enabled = true
  action.paused = false
  if (!action.isRunning()) {
    action.play()
  }
  action.setEffectiveWeight(weight)
  action.setEffectiveTimeScale(timeScale)
}

type RobotRenderableMaterial = Material & {
  alphaTest?: number
  color?: Color
  depthTest?: boolean
  depthWrite?: boolean
  emissive?: Color
  emissiveIntensity?: number
  metalness?: number
  name: string
  opacity?: number
  roughness?: number
  side?: number
  toneMapped?: boolean
  transparent?: boolean
}

function cloneRobotMaterial(material: Material): Material {
  const sourceMaterial = material as RobotRenderableMaterial
  const clonedMaterial = material.clone() as RobotRenderableMaterial & Material
  clonedMaterial.name = sourceMaterial.name
  clonedMaterial.transparent = sourceMaterial.transparent ?? false
  clonedMaterial.opacity = sourceMaterial.opacity ?? 1
  clonedMaterial.alphaTest = sourceMaterial.alphaTest ?? 0
  clonedMaterial.depthTest = sourceMaterial.depthTest ?? true
  clonedMaterial.depthWrite = sourceMaterial.depthWrite ?? true
  clonedMaterial.toneMapped = sourceMaterial.toneMapped ?? true
  clonedMaterial.side = clonedMaterial.transparent ? (sourceMaterial.side ?? FrontSide) : FrontSide
  clonedMaterial.needsUpdate = true
  return clonedMaterial
}

function cloneObjectMaterials(material: Material | Material[]) {
  return Array.isArray(material)
    ? material.map((entry) => cloneRobotMaterial(entry))
    : cloneRobotMaterial(material)
}

function disposeObjectMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => {
      entry.dispose()
    })
    return
  }

  material.dispose()
}

function normalizeRobotBaseMaterials(material: Material | Material[]) {
  const materials = Array.isArray(material) ? material : [material]
  for (const entry of materials) {
    if (!entry.transparent) {
      entry.side = FrontSide
    }
    entry.needsUpdate = true
  }
}

function normalizeRobotRevealMaterials(material: Material | Material[]) {
  const materials = Array.isArray(material) ? material : [material]
  for (const entry of materials) {
    const robotMaterial = entry as RobotRenderableMaterial
    if (!entry.transparent) {
      entry.side = FrontSide
    }
    robotMaterial.transparent = true
    robotMaterial.depthTest = true
    robotMaterial.depthWrite = false
    robotMaterial.toneMapped = false
    if (robotMaterial.emissive) {
      robotMaterial.emissive.copy(robotMaterial.color ?? new Color(0xffffff))
      robotMaterial.emissiveIntensity = Math.max(robotMaterial.emissiveIntensity ?? 0, 0.55)
    }
    robotMaterial.needsUpdate = true
  }
}

function isExcludedFromToolReveal(object: Object3D | null) {
  let current: Object3D | null = object
  while (current) {
    if (
      typeof current.userData === 'object' &&
      current.userData !== null &&
      current.userData.pascalExcludeFromToolReveal === true
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function recordNavigationRobotFramePerf(frameStart: number) {
  recordNavigationPerfSample('navigationRobot.frameMs', performance.now() - frameStart)
}

function setToolConeIsolatedOverlay(
  overlay: {
    apexWorldPoint?: [number, number, number] | null
    color?: string | null
    hullPoints: Array<{
      isApex: boolean
      worldPoint: [number, number, number]
    }>
    supportWorldPoints?: Array<[number, number, number]>
    visible: boolean
  } | null,
) {
  navigationVisualsStore.getState().setToolConeIsolatedOverlay(overlay)
}

function computeRobotRevealBounds(rootGroup: Group, targetBounds: Box3, scratchBounds: Box3) {
  targetBounds.makeEmpty()
  rootGroup.updateWorldMatrix(true, true)

  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !child.isMesh) {
      return
    }
    if (isExcludedFromToolReveal(child as Object3D)) {
      return
    }

    const mesh = child as Mesh & {
      boundingBox?: Box3 | null
      computeBoundingBox?: () => void
      geometry?: { boundingBox?: Box3 | null; computeBoundingBox?: () => void } | undefined
      isSkinnedMesh?: boolean
      matrixWorld: Group['matrixWorld']
    }

    if (mesh.isSkinnedMesh && typeof mesh.computeBoundingBox === 'function') {
      mesh.computeBoundingBox()
      if (mesh.boundingBox) {
        scratchBounds.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld)
        targetBounds.union(scratchBounds)
      }
      return
    }

    const geometry = mesh.geometry
    if (!geometry) {
      return
    }

    geometry.computeBoundingBox?.()
    if (geometry.boundingBox) {
      scratchBounds.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
      targetBounds.union(scratchBounds)
    }
  })

  return targetBounds
}

function createRevealMaterialBinding(
  material: Material,
  revealMinY: number,
  revealMaxY: number,
): RevealMaterialBinding {
  const clonedMaterial = material as RevealMaterialBinding['material']
  const revealProgressUniform = { value: 1 }
  const revealMinYUniform = { value: revealMinY }
  const revealMaxYUniform = { value: revealMaxY }
  const revealFeatherUniform = { value: Math.max((revealMaxY - revealMinY) * 0.04, 0.02) }
  const revealProgressNode = uniform(revealProgressUniform.value)
  const revealMinYNode = uniform(revealMinYUniform.value)
  const revealMaxYNode = uniform(revealMaxYUniform.value)
  const revealFeatherNode = uniform(revealFeatherUniform.value)
  const originalOnBeforeCompile = clonedMaterial.onBeforeCompile?.bind(clonedMaterial)
  const originalCustomProgramCacheKey = clonedMaterial.customProgramCacheKey?.bind(clonedMaterial)
  const revealCutoffNode = mix(
    revealMinYNode.sub(revealFeatherNode),
    revealMaxYNode.add(revealFeatherNode),
    float(revealProgressNode).clamp(0, 1),
  )
  const revealAlphaNode = float(1).sub(
    smoothstep(
      revealCutoffNode.sub(revealFeatherNode),
      revealCutoffNode.add(revealFeatherNode),
      positionWorld.y,
    ),
  )
  const revealOpacityNode = (materialOpacity as any).mul(revealAlphaNode)

  clonedMaterial.transparent = true
  clonedMaterial.alphaTest = Math.max(clonedMaterial.alphaTest ?? 0, 0.001)
  clonedMaterial.alphaTestNode = float(clonedMaterial.alphaTest)
  clonedMaterial.maskNode = revealOpacityNode.greaterThan(float(0.001))
  clonedMaterial.opacityNode = revealOpacityNode
  clonedMaterial.onBeforeCompile = (shader) => {
    originalOnBeforeCompile?.(shader)
    shader.uniforms.uPascalRevealProgress = revealProgressUniform
    shader.uniforms.uPascalRevealMinY = revealMinYUniform
    shader.uniforms.uPascalRevealMaxY = revealMaxYUniform
    shader.uniforms.uPascalRevealFeather = revealFeatherUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPascalRevealY;')
      .replace(
        '#include <project_vertex>',
        'vec4 pascalRevealWorldPosition = modelMatrix * vec4(transformed, 1.0);\nvPascalRevealY = pascalRevealWorldPosition.y;\n#include <project_vertex>',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vPascalRevealY;\nuniform float uPascalRevealFeather;\nuniform float uPascalRevealMaxY;\nuniform float uPascalRevealMinY;\nuniform float uPascalRevealProgress;',
      )
      .replace(
        '#include <opaque_fragment>',
        `float pascalRevealCutoff = mix(uPascalRevealMinY - uPascalRevealFeather, uPascalRevealMaxY + uPascalRevealFeather, clamp(uPascalRevealProgress, 0.0, 1.0));
float pascalRevealAlpha = 1.0 - smoothstep(pascalRevealCutoff - uPascalRevealFeather, pascalRevealCutoff + uPascalRevealFeather, vPascalRevealY);
diffuseColor.a *= pascalRevealAlpha;
if (diffuseColor.a <= 0.001) discard;
#include <opaque_fragment>`,
      )
  }
  clonedMaterial.customProgramCacheKey = () =>
    `${originalCustomProgramCacheKey?.() ?? ''}|pascal-robot-reveal`
  clonedMaterial.needsUpdate = true

  return {
    material: clonedMaterial,
    uniforms: {
      revealFeather: revealFeatherUniform,
      revealMaxY: revealMaxYUniform,
      revealMinY: revealMinYUniform,
      revealProgress: revealProgressUniform,
    },
    webgpuUniforms: {
      revealFeather: revealFeatherNode as RevealUniform,
      revealMaxY: revealMaxYNode as RevealUniform,
      revealMinY: revealMinYNode as RevealUniform,
      revealProgress: revealProgressNode as RevealUniform,
    },
  }
}

export function NavigationRobot({
  active = true,
  animationPaused = false,
  clipNameOverrides,
  debugId,
  debugStateRef,
  debugTransitionPreview,
  forcedClipPlayback,
  forcedClipVisualOffset,
  hoverOffset,
  motionRef,
  onReady,
  onSceneReady,
  onWarmupReadyChange,
  materialDebugMode = 'auto',
  skinnedMeshVisibilityOverride = null,
  staticMeshVisibilityOverride = null,
  showToolAttachments = false,
  toolConeColor = null,
  toolCarryItemId = null,
  toolCarryItemIdRef,
  toolInteractionPhaseRef,
  toolInteractionTargetItemIdRef,
}: NavigationRobotProps) {
  const { camera: sceneCamera, gl, scene: rootScene } = useThree()
  const [assetUrl, setAssetUrl] = useState(() =>
    getNavigationRobotAssetUrl(typeof window === 'undefined' ? null : window.localStorage),
  )
  const { scene, animations } = useGLTF(assetUrl)
  const { scene: toolScene } = useGLTF(TOOL_ASSET_PATH)
  const clonedScene = useMemo(
    () =>
      measureNavigationPerf('navigationRobot.cloneSceneMs', () => cloneSkeleton(scene) as Group),
    [scene],
  )
  const runtimePlanarRootMotionClips = useMemo(() => {
    const clipByName = new Map<string, RuntimePlanarRootMotionClip>()
    const processedAnimations = animations.map((clip) => {
      if (clip.name !== 'Jumping_Down') {
        return clip
      }

      const runtimePlanarRootMotionClip = buildRuntimePlanarRootMotionClip(clip)
      if (!runtimePlanarRootMotionClip) {
        return clip
      }

      clipByName.set(clip.name, runtimePlanarRootMotionClip)
      return runtimePlanarRootMotionClip.playbackClip
    })

    return {
      animations: processedAnimations,
      byName: clipByName,
    }
  }, [animations])
  const { actions, mixer } = useAnimations(runtimePlanarRootMotionClips.animations, clonedScene)
  const [storedClipOverrides, setStoredClipOverrides] = useState<NavigationRobotClipOverrideState>(
    DEFAULT_NAVIGATION_ROBOT_CLIP_OVERRIDES,
  )
  const skinnedMeshBaseVisibilityRef = useRef(new WeakMap<Mesh, boolean>())
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncStoredClipOverrides = () => {
      setStoredClipOverrides(readNavigationRobotClipOverrides(window.localStorage))
    }
    const syncAssetUrl = () => {
      setAssetUrl(getNavigationRobotAssetUrl(window.localStorage))
    }

    syncStoredClipOverrides()
    syncAssetUrl()
    window.addEventListener(NAVIGATION_ROBOT_ASSET_UPDATED_EVENT, syncAssetUrl)
    window.addEventListener(NAVIGATION_ROBOT_CLIP_OVERRIDE_EVENT, syncStoredClipOverrides)
    window.addEventListener('storage', syncStoredClipOverrides)
    window.addEventListener('storage', syncAssetUrl)
    return () => {
      window.removeEventListener(NAVIGATION_ROBOT_ASSET_UPDATED_EVENT, syncAssetUrl)
      window.removeEventListener(NAVIGATION_ROBOT_CLIP_OVERRIDE_EVENT, syncStoredClipOverrides)
      window.removeEventListener('storage', syncStoredClipOverrides)
      window.removeEventListener('storage', syncAssetUrl)
    }
  }, [])

  useLayoutEffect(() => {
    clonedScene.traverse((child) => {
      const mesh = child as Mesh & { isSkinnedMesh?: boolean }
      if (!mesh.isMesh) {
        return
      }

      if (!skinnedMeshBaseVisibilityRef.current.has(mesh)) {
        skinnedMeshBaseVisibilityRef.current.set(mesh, mesh.visible)
      }

      const baseVisible = skinnedMeshBaseVisibilityRef.current.get(mesh) ?? true
      if (mesh.isSkinnedMesh) {
        mesh.visible =
          skinnedMeshVisibilityOverride === null
            ? baseVisible
            : baseVisible && skinnedMeshVisibilityOverride
        return
      }

      mesh.visible =
        staticMeshVisibilityOverride === null
          ? baseVisible
          : baseVisible && staticMeshVisibilityOverride
    })
  }, [clonedScene, skinnedMeshVisibilityOverride, staticMeshVisibilityOverride])
  const resolvedClipOverrides = useMemo<NavigationRobotClipOverrideState>(
    () => ({
      idle: clipNameOverrides?.idle ?? storedClipOverrides.idle,
      run: clipNameOverrides?.run ?? storedClipOverrides.run,
      walk: clipNameOverrides?.walk ?? storedClipOverrides.walk,
    }),
    [
      clipNameOverrides?.idle,
      clipNameOverrides?.run,
      clipNameOverrides?.walk,
      storedClipOverrides.idle,
      storedClipOverrides.run,
      storedClipOverrides.walk,
    ],
  )
  const idleClipNames = useMemo(
    () =>
      getNavigationRobotClipNames(
        DEFAULT_NAVIGATION_ROBOT_IDLE_CLIP_NAMES,
        resolvedClipOverrides.idle,
      ),
    [resolvedClipOverrides.idle],
  )
  const walkClipNames = useMemo(
    () =>
      getNavigationRobotClipNames(
        DEFAULT_NAVIGATION_ROBOT_WALK_CLIP_NAMES,
        resolvedClipOverrides.walk,
      ),
    [resolvedClipOverrides.walk],
  )
  const runClipNames = useMemo(
    () =>
      getNavigationRobotClipNames(
        DEFAULT_NAVIGATION_ROBOT_RUN_CLIP_NAMES,
        resolvedClipOverrides.run,
      ),
    [resolvedClipOverrides.run],
  )
  const forcedClipAction =
    forcedClipPlayback?.clipName && forcedClipPlayback.clipName.length > 0
      ? (actions[forcedClipPlayback.clipName] ?? null)
      : null
  const allAnimationActions = useMemo(
    () => Object.values(actions).filter((action): action is AnimationAction => Boolean(action)),
    [actions],
  )
  const fallbackAction = allAnimationActions[0] ?? null
  const idleAction = getFirstAvailableAction(actions, idleClipNames) ?? fallbackAction ?? null
  const walkAction = getFirstAvailableAction(actions, walkClipNames) ?? idleAction
  const runAction = getFirstAvailableAction(actions, runClipNames) ?? walkAction ?? idleAction
  const locomotionActions = useMemo(
    () => getUniqueActions([idleAction, walkAction, runAction]),
    [idleAction, runAction, walkAction],
  )
  const runtimeActions = useMemo(
    () => getUniqueActions([...locomotionActions, forcedClipAction]),
    [forcedClipAction, locomotionActions],
  )
  const activeClipNameRef = useRef<string | null>(null)
  const animationBlendStateRef = useRef<AnimationBlendState>({
    idleWeight: 1,
    runTimeScale: 1,
    runWeight: 0,
    walkTimeScale: 1,
    walkWeight: 0,
  })
  const debugBoneSamplesRef = useRef<DebugBoneSample[]>([])
  const debugMovingEvidenceRef = useRef(0)
  const revealMaterialBindingsRef = useRef<RevealMaterialBinding[]>([])
  const revealMaterialEntriesRef = useRef<RevealMaterialEntry[]>([])
  const revealMaterialsActiveRef = useRef(false)
  const toolRevealMaterialBindingsRef = useRef<RevealMaterialBinding[]>([])
  const toolRevealMaterialEntriesRef = useRef<RevealMaterialEntry[]>([])
  const toolRevealMaterialsActiveRef = useRef(false)
  const readySignalKeyRef = useRef<string | null>(null)
  const materialWarmupQueuedRef = useRef(false)
  const [materialWarmupReady, setMaterialWarmupReady] = useState(false)
  const resolveRevealMaterialsShouldBeActive = useMemo(
    () => (autoValue: boolean) => {
      if (materialDebugMode === 'reveal-only') {
        return true
      }
      if (materialDebugMode === 'original-only') {
        return false
      }
      return autoValue
    },
    [materialDebugMode],
  )

  const shoulderBonesRef = useRef<Partial<Record<ShoulderBoneName, Object3D>>>({})
  const leftShoulderFollowBoneRef = useRef<Object3D | null>(null)
  const leftUpperArmBoneRef = useRef<Object3D | null>(null)
  const leftElbowBoneRef = useRef<Object3D | null>(null)
  const leftHandBoneRef = useRef<Object3D | null>(null)
  const leftToolRenderable = useMemo(
    () =>
      createToolRenderable(
        toolScene,
        'navigation-robot-tool-left',
        LEFT_TOOL_OFFSET,
        LEFT_TOOL_ROTATION_DEGREES,
      ),
    [toolScene],
  )
  const leftToolConeMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      color: TOOL_CONE_OVERLAY_COLOR,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      transparent: true,
    })
    const opacityGradient = createBendFadeNode(TOOL_CONE_GRADIENT_BEND).mul(
      float(TOOL_CONE_OPACITY_SCALE),
    )
    material.opacityNode = opacityGradient
    material.maskNode = opacityGradient.greaterThan(float(0.001))
    material.toneMapped = false
    material.transparent = true
    material.depthTest = false
    material.depthWrite = false
    return material
  }, [])
  const leftToolConeOccludedMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      color: TOOL_CONE_OVERLAY_COLOR,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      transparent: true,
    })
    const opacityGradient = createBendFadeNode(TOOL_CONE_GRADIENT_BEND).mul(
      float(TOOL_CONE_OPACITY_SCALE),
    )
    material.opacityNode = opacityGradient
    material.maskNode = opacityGradient.greaterThan(float(0.001))
    material.toneMapped = false
    material.transparent = true
    material.depthTest = false
    material.depthWrite = false
    return material
  }, [])
  const leftToolConeOutlineMaterial = useMemo(() => {
    const material = new LineBasicMaterial({
      color: TOOL_CONE_OVERLAY_COLOR,
      depthTest: true,
      opacity: 0.96 * TOOL_CONE_OPACITY_SCALE,
      transparent: true,
    })
    material.toneMapped = false
    return material
  }, [])
  const leftToolConeOccludedOutlineMaterial = useMemo(() => {
    const material = new LineBasicMaterial({
      color: TOOL_CONE_OVERLAY_COLOR,
      depthTest: true,
      opacity: 0.96 * TOOL_CONE_OPACITY_SCALE,
      transparent: true,
    })
    material.toneMapped = false
    return material
  }, [])
  const leftToolConeInwardGlowMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      color: TOOL_CONE_EDGE_GLOW_COLOR,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      transparent: true,
    })
    const inwardFade = smoothstep(float(0), float(1), uv().x)
      .pow(float(TOOL_CONE_EDGE_GLOW_INWARD_GRADIENT_BEND))
      .oneMinus()
    const lengthFade = uv().y.oneMinus().pow(float(TOOL_CONE_EDGE_GLOW_ATTENUATION))
    const glowOpacity = inwardFade.mul(lengthFade).mul(float(TOOL_CONE_EDGE_GLOW_BRIGHTNESS))
    material.opacityNode = glowOpacity
    material.maskNode = glowOpacity.greaterThan(float(0.001))
    material.toneMapped = false
    material.transparent = true
    material.depthTest = false
    material.depthWrite = false
    material.blending = AdditiveBlending
    return material
  }, [])
  const leftToolConeOccludedInwardGlowMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      color: TOOL_CONE_EDGE_GLOW_COLOR,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      transparent: true,
    })
    const inwardFade = smoothstep(float(0), float(1), uv().x)
      .pow(float(TOOL_CONE_EDGE_GLOW_INWARD_GRADIENT_BEND))
      .oneMinus()
    const lengthFade = uv().y.oneMinus().pow(float(TOOL_CONE_EDGE_GLOW_ATTENUATION))
    const glowOpacity = inwardFade.mul(lengthFade).mul(float(TOOL_CONE_EDGE_GLOW_BRIGHTNESS))
    material.opacityNode = glowOpacity
    material.maskNode = glowOpacity.greaterThan(float(0.001))
    material.toneMapped = false
    material.transparent = true
    material.depthTest = false
    material.depthWrite = false
    material.blending = AdditiveBlending
    return material
  }, [])
  const leftToolConeOutwardGlowMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      color: TOOL_CONE_EDGE_GLOW_COLOR,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      transparent: true,
    })
    const outwardFade = smoothstep(float(0), float(1), uv().x)
      .pow(float(TOOL_CONE_EDGE_GLOW_OUTWARD_GRADIENT_BEND))
      .oneMinus()
    const lengthFade = uv().y.oneMinus().pow(float(TOOL_CONE_EDGE_GLOW_ATTENUATION))
    const glowOpacity = outwardFade.mul(lengthFade).mul(float(TOOL_CONE_EDGE_GLOW_BRIGHTNESS))
    material.opacityNode = glowOpacity
    material.maskNode = glowOpacity.greaterThan(float(0.001))
    material.toneMapped = false
    material.transparent = true
    material.depthTest = false
    material.depthWrite = false
    material.blending = AdditiveBlending
    return material
  }, [])
  const leftToolConeOccludedOutwardGlowMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      color: TOOL_CONE_EDGE_GLOW_COLOR,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      transparent: true,
    })
    const outwardFade = smoothstep(float(0), float(1), uv().x)
      .pow(float(TOOL_CONE_EDGE_GLOW_OUTWARD_GRADIENT_BEND))
      .oneMinus()
    const lengthFade = uv().y.oneMinus().pow(float(TOOL_CONE_EDGE_GLOW_ATTENUATION))
    const glowOpacity = outwardFade.mul(lengthFade).mul(float(TOOL_CONE_EDGE_GLOW_BRIGHTNESS))
    material.opacityNode = glowOpacity
    material.maskNode = glowOpacity.greaterThan(float(0.001))
    material.toneMapped = false
    material.transparent = true
    material.depthTest = false
    material.depthWrite = false
    material.blending = AdditiveBlending
    return material
  }, [])
  const leftToolConeOverlayRenderable = useMemo(
    () =>
      createToolConeRenderable(
        'navigation-robot-tool-left-cone-overlay',
        leftToolConeMaterial,
        leftToolConeOutlineMaterial,
        leftToolConeInwardGlowMaterial,
        leftToolConeOutwardGlowMaterial,
      ),
    [
      leftToolConeInwardGlowMaterial,
      leftToolConeMaterial,
      leftToolConeOutwardGlowMaterial,
      leftToolConeOutlineMaterial,
    ],
  )
  const leftToolConeOccludedRenderable = useMemo(
    () =>
      createToolConeRenderable(
        'navigation-robot-tool-left-cone-occluded',
        leftToolConeOccludedMaterial,
        leftToolConeOccludedOutlineMaterial,
        leftToolConeOccludedInwardGlowMaterial,
        leftToolConeOccludedOutwardGlowMaterial,
      ),
    [
      leftToolConeOccludedInwardGlowMaterial,
      leftToolConeOccludedMaterial,
      leftToolConeOccludedOutlineMaterial,
      leftToolConeOccludedOutwardGlowMaterial,
    ],
  )
  const leftToolConeRenderables = useMemo(
    () => [leftToolConeOverlayRenderable, leftToolConeOccludedRenderable] as const,
    [leftToolConeOccludedRenderable, leftToolConeOverlayRenderable],
  )
  useEffect(() => {
    const nextColor = new Color(toolConeColor ?? TOOL_CONE_OVERLAY_COLOR)
    leftToolConeMaterial.color.set(nextColor)
    leftToolConeOccludedMaterial.color.set(nextColor)
    leftToolConeOutlineMaterial.color.set(nextColor)
    leftToolConeOccludedOutlineMaterial.color.set(nextColor)
    leftToolConeInwardGlowMaterial.color.set(nextColor)
    leftToolConeOccludedInwardGlowMaterial.color.set(nextColor)
    leftToolConeOutwardGlowMaterial.color.set(nextColor)
    leftToolConeOccludedOutwardGlowMaterial.color.set(nextColor)
  }, [
    leftToolConeInwardGlowMaterial,
    leftToolConeMaterial,
    leftToolConeOccludedInwardGlowMaterial,
    leftToolConeOccludedMaterial,
    leftToolConeOccludedOutlineMaterial,
    leftToolConeOccludedOutwardGlowMaterial,
    leftToolConeOutlineMaterial,
    leftToolConeOutwardGlowMaterial,
    toolConeColor,
  ])
  const checkoutLeftHandRotationRef = useRef(
    new Quaternion().setFromEuler(
      new Euler(
        MathUtils.degToRad(CHECKOUT_LEFT_HAND_ROTATION_DEGREES.x),
        MathUtils.degToRad(CHECKOUT_LEFT_HAND_ROTATION_DEGREES.y),
        MathUtils.degToRad(CHECKOUT_LEFT_HAND_ROTATION_DEGREES.z),
      ),
    ),
  )
  const checkoutLeftHandScratchRef = useRef(new Quaternion())
  const checkoutLeftHandBaseQuaternionRef = useRef(new Quaternion())
  const checkoutLeftHandRestorePendingRef = useRef(false)
  const visualOffsetGroupRef = useRef<Group>(null)
  const rootGroupRef = useRef<Group>(null)
  const rootMotionBoneRef = useRef<Object3D | null>(null)
  const rootMotionBaselineScenePositionRef = useRef<Vector3 | null>(null)
  const rootMotionBaselineWorldRef = useRef(new Vector3())
  const rootMotionCurrentWorldRef = useRef(new Vector3())
  const rootMotionOffsetRef = useRef(new Vector3())
  const runtimePlanarRootMotionLocalOffsetRef = useRef(new Vector3())
  const runtimePlanarRootMotionWorldOriginRef = useRef(new Vector3())
  const runtimePlanarRootMotionWorldTargetRef = useRef(new Vector3())
  const runtimePlanarRootMotionWorldOffsetRef = useRef(new Vector3())
  const runtimePlanarRootMotionVisualOriginRef = useRef(new Vector3())
  const runtimePlanarRootMotionVisualTargetRef = useRef(new Vector3())
  const runtimePlanarRootMotionVisualOffsetRef = useRef(new Vector3())
  const previousForcedClipActionRef = useRef<AnimationAction | null>(null)
  const releasedForcedActionRef = useRef<AnimationAction | null>(null)
  const releasedForcedWeightRef = useRef(0)
  const toolConeSupportWorldPointsRef = useRef(TOOL_CONE_SUPPORT_SIGNS.map(() => new Vector3()))
  const toolConeSupportLocalPointsRef = useRef(TOOL_CONE_SUPPORT_SIGNS.map(() => new Vector3()))
  const toolConeSupportScoresRef = useRef(TOOL_CONE_SUPPORT_SIGNS.map(() => -Infinity))
  const toolConeSupportDiagnosticsRef = useRef<(ToolConeSupportPointDiagnostic | null)[]>(
    TOOL_CONE_SUPPORT_SIGNS.map(() => null),
  )
  const toolConeFrozenHullTargetItemIdRef = useRef<string | null>(null)
  const toolConeFrozenHullPointsRef = useRef<FrozenToolConeHullPoint[]>([])
  const toolConeFrozenHullWorldPointScratchRef = useRef(new Vector3())
  const toolConeScratchPointRef = useRef(new Vector3())
  const toolConeProjectedHullCandidatesRef = useRef<ProjectedHullCandidate[]>([])
  const toolConeApexWorldPointRef = useRef(new Vector3())
  const toolConeApexLocalPointRef = useRef(new Vector3())
  const toolConeCarryTargetBoundsRef = useRef(new Box3())
  const toolConeCarryTargetCenterRef = useRef(new Vector3())
  const toolConeFollowReleaseBlendRef = useRef(0)
  const toolConeFollowReleasePoseReadyRef = useRef(false)
  const toolConeFollowReleaseShoulderQuaternionRef = useRef(new Quaternion())
  const toolConeFollowReleaseUpperArmQuaternionRef = useRef(new Quaternion())
  const toolConeFollowReleaseElbowQuaternionRef = useRef(new Quaternion())
  const toolConeFollowReleaseLeftHandQuaternionRef = useRef(new Quaternion())
  const toolConeFollowShoulderTargetRef = useRef(new Vector3())
  const toolConeFollowForearmTargetRef = useRef(new Vector3())
  const toolConeFrameIdRef = useRef(0)
  const toolConePrewarmedRef = useRef(false)
  const toolConeLogicExpectedFrameIdRef = useRef<number | null>(null)
  const toolConeVisibleFrameIdRef = useRef<number | null>(null)
  const toolConeSubmittedAnyFrameIdRef = useRef<number | null>(null)
  const toolConeSubmittedMainFrameIdRef = useRef<number | null>(null)
  const toolConeSubmittedInwardGlowFrameIdRef = useRef<number | null>(null)
  const toolConeSubmittedOutwardGlowFrameIdRef = useRef<number | null>(null)
  const toolConeLastSubmittedAtMsRef = useRef<number | null>(null)
  const toolConePreviousFrameLogicExpectedRef = useRef(false)
  const toolConePreviousFrameVisibleRef = useRef(false)
  const toolConePreviousFrameSubmittedAnyRef = useRef(false)
  const toolConePreviousFrameSubmittedMainRef = useRef(false)
  const toolConePreviousFrameSubmittedInwardGlowRef = useRef(false)
  const toolConePreviousFrameSubmittedOutwardGlowRef = useRef(false)
  const toolConeFailureStreakFramesRef = useRef(0)
  const toolConeGeometryMissStreakFramesRef = useRef(0)
  const toolConeRenderMissStreakFramesRef = useRef(0)
  const toolConeHullProjectedPointScratchRef = useRef(new Vector3())
  const toolConeRenderedWorldPointScratchRef = useRef(new Vector3())
  const shoulderAimBoneWorldPositionRef = useRef(new Vector3())
  const shoulderAimParentWorldQuaternionRef = useRef(new Quaternion())
  const shoulderAimTargetDirectionParentRef = useRef(new Vector3())
  const shoulderAimTargetDirectionWorldRef = useRef(new Vector3())
  const shoulderAimTargetLocalQuaternionRef = useRef(new Quaternion())
  const upperArmAimBoneWorldPositionRef = useRef(new Vector3())
  const upperArmAimParentWorldQuaternionRef = useRef(new Quaternion())
  const upperArmAimTargetDirectionParentRef = useRef(new Vector3())
  const upperArmAimTargetDirectionWorldRef = useRef(new Vector3())
  const upperArmAimTargetLocalQuaternionRef = useRef(new Quaternion())
  const forearmAimBoneWorldPositionRef = useRef(new Vector3())
  const forearmAimParentWorldQuaternionRef = useRef(new Quaternion())
  const forearmAimTargetDirectionParentRef = useRef(new Vector3())
  const forearmAimTargetDirectionWorldRef = useRef(new Vector3())
  const forearmAimTargetLocalQuaternionRef = useRef(new Quaternion())
  const revealBoundsRef = useRef(new Box3())
  const revealBoundsScratchRef = useRef(new Box3())
  const visualRevealProgressRef = useRef(1)
  const toolRevealBoundsRef = useRef(new Box3())
  const toolRevealBoundsScratchRef = useRef(new Box3())
  const toolVisualRevealProgressRef = useRef(1)
  const forcedClipPlaybackKey = forcedClipPlayback
    ? [
        forcedClipPlayback.clipName,
        forcedClipPlayback.loop ?? 'once',
        forcedClipPlayback.playbackToken ?? 'stable',
        forcedClipPlayback.revealFromStart ? 'reveal' : 'plain',
        forcedClipPlayback.stabilizeRootMotion ? 'stabilized' : 'free',
        forcedClipPlayback.timeScale ?? 1,
        forcedClipPlayback.holdLastFrame ? 'hold' : 'release',
      ].join(':')
    : null
  const debugTransitionPreviewClipName = debugTransitionPreview?.releasedClipName ?? null
  const robotTransform = useMemo(
    () =>
      measureNavigationPerf('navigationRobot.transformMs', () =>
        getRobotTransform(clonedScene, hoverOffset),
      ),
    [clonedScene, hoverOffset],
  )
  const idleShoulderTargets = useMemo<ShoulderPoseTargets>(() => {
    const idleClip = idleAction?.getClip() ?? null
    if (!idleClip) {
      return {}
    }

    const targets: ShoulderPoseTargets = {}
    for (const shoulderBoneName of SHOULDER_BONE_NAMES) {
      const shoulderTrack = findBoneQuaternionTrack(idleClip, shoulderBoneName)
      if (!shoulderTrack) {
        continue
      }

      targets[shoulderBoneName] = readTrackFirstQuaternion(shoulderTrack, new Quaternion())
    }
    return targets
  }, [idleAction])
  const initialSceneRevealProgressRef = useRef(forcedClipPlayback?.revealFromStart ? 0 : 1)

  useEffect(() => {
    onSceneReady?.(clonedScene)

    return () => {
      onSceneReady?.(null)
    }
  }, [clonedScene, onSceneReady])

  useEffect(() => {
    const detachTool = (toolRenderable: Group) => {
      if (toolRenderable.parent) {
        toolRenderable.parent.remove(toolRenderable)
      }
    }
    for (const toolConeRenderable of leftToolConeRenderables) {
      if (toolConeRenderable.group.parent) {
        toolConeRenderable.group.parent.remove(toolConeRenderable.group)
      }
    }

    if (!showToolAttachments) {
      detachTool(leftToolRenderable)
      return
    }

    const leftHandBone = leftHandBoneRef.current

    if (leftHandBone) {
      leftHandBone.add(leftToolRenderable)
    } else {
      detachTool(leftToolRenderable)
    }

    return () => {
      detachTool(leftToolRenderable)
    }
  }, [clonedScene, leftToolConeRenderables, leftToolRenderable, showToolAttachments])

  useEffect(() => {
    toolConePrewarmedRef.current = false
  }, [leftToolConeRenderables])

  useEffect(() => {
    toolConePrewarmedRef.current = true
    return
  }, [gl, leftToolConeRenderables, rootScene, sceneCamera, showToolAttachments])

  useEffect(() => {
    materialWarmupQueuedRef.current = false
    setMaterialWarmupReady(false)
  }, [clonedScene, leftToolConeRenderables, leftToolRenderable])

  useEffect(() => {
    onWarmupReadyChange?.(materialWarmupReady)
  }, [materialWarmupReady, onWarmupReadyChange])

  useEffect(() => {
    if (materialWarmupQueuedRef.current) {
      return
    }

    if (
      revealMaterialEntriesRef.current.length === 0 &&
      toolRevealMaterialEntriesRef.current.length === 0
    ) {
      setMaterialWarmupReady(true)
      return
    }

    materialWarmupQueuedRef.current = true
    let cancelled = false
    const fallbackTimeoutId = window.setTimeout(() => {
      if (cancelled) {
        return
      }

      recordNavigationPerfMark('navigationRobot.materialWarmupFallbackReady', {
        timeoutMs: NAVIGATION_ROBOT_MATERIAL_WARMUP_FALLBACK_MS,
      })
      setMaterialWarmupReady(true)
    }, NAVIGATION_ROBOT_MATERIAL_WARMUP_FALLBACK_MS)
    const compileWarmup = async () => {
      if (cancelled) {
        return
      }

      const warmupRoot = new Group()
      warmupRoot.name = '__pascalRobotWarmupRoot__'
      const warmupRoots: Object3D[] = []
      const addWarmupRoot = (root: Object3D, x: number, z: number) => {
        root.position.set(x, 0, z)
        disableFrustumCulling(root)
        warmupRoot.add(root)
        warmupRoots.push(root)
      }

      const warmupCamera = new PerspectiveCamera(42, 1, 0.01, 20)
      warmupCamera.position.set(0, 1.2, 3.6)
      warmupCamera.lookAt(0, 1.05, -0.8)
      warmupCamera.updateProjectionMatrix()
      warmupCamera.updateMatrixWorld(true)

      const warmRobotOriginal = cloneSkeleton(clonedScene) as Group
      const warmRobotReveal = cloneSkeleton(clonedScene) as Group
      applyWarmupRevealMaterials(warmRobotReveal, revealMaterialEntriesRef.current)
      addWarmupRoot(warmRobotOriginal, -0.9, -1.4)
      addWarmupRoot(warmRobotReveal, 0.9, -1.4)

      if (showToolAttachments) {
        const warmToolOriginal = leftToolRenderable.clone(true)
        const warmToolReveal = leftToolRenderable.clone(true)
        applyWarmupRevealMaterials(warmToolReveal, toolRevealMaterialEntriesRef.current)
        addWarmupRoot(warmToolOriginal, -0.25, -0.8)
        addWarmupRoot(warmToolReveal, 0.25, -0.8)
      }

      leftToolConeRenderables.forEach((renderable, index) => {
        addWarmupRoot(renderable.group.clone(true), -0.45 + index * 0.3, -0.35)
      })
      scene.add(warmupRoot)

      const renderer = gl as unknown as {
        backend?: { isWebGPUBackend?: boolean }
        compileAsync?: (scene: Scene, camera: object) => Promise<unknown>
        domElement?: { height?: number; width?: number }
        getDrawingBufferSize?: (target: Vector2) => Vector2
        render?: (scene: Scene, camera: object) => void
        setScissor?: (x: number, y: number, width: number, height: number) => void
        setScissorTest?: (enabled: boolean) => void
        setRenderTarget?: (target: RenderTarget | null) => void
        setViewport?: (x: number, y: number, width: number, height: number) => void
      }
      const warmupStart = performance.now()
      const renderTarget = new RenderTarget(96, 96, { depthBuffer: true })
      const renderWarmupPass = (sampleName: string, cameraOverride: Camera = warmupCamera) => {
        const renderStart = performance.now()
        const drawingBufferSize = getRendererDrawingBufferSize(renderer)
        const canvasWidth = Math.max(1, Math.floor(drawingBufferSize.x))
        const canvasHeight = Math.max(1, Math.floor(drawingBufferSize.y))
        const allowScreenWarmupPass = !isTrueWebGPUBackend(renderer)
        try {
          renderer.setRenderTarget?.(renderTarget)
          renderer.render?.(scene as unknown as Scene, cameraOverride)
          recordNavigationPerfSample(sampleName, performance.now() - renderStart)

          if (
            allowScreenWarmupPass &&
            renderer.setViewport &&
            renderer.setScissor &&
            renderer.setScissorTest &&
            canvasWidth > 0 &&
            canvasHeight > 0
          ) {
            const screenRenderStart = performance.now()
            renderer.setRenderTarget?.(null)
            renderer.setScissorTest(true)
            renderer.setViewport(0, 0, 1, 1)
            renderer.setScissor(0, 0, 1, 1)
            renderer.render?.(scene as unknown as Scene, cameraOverride)
            recordNavigationPerfSample(
              `${sampleName.replace(/Ms$/, '')}ScreenMs`,
              performance.now() - screenRenderStart,
            )
          }
        } finally {
          if (renderer.setViewport && renderer.setScissor && renderer.setScissorTest) {
            renderer.setRenderTarget?.(null)
            renderer.setViewport(0, 0, canvasWidth, canvasHeight)
            renderer.setScissor(0, 0, canvasWidth, canvasHeight)
            renderer.setScissorTest(false)
          }
        }
      }
      try {
        try {
          await (renderer.compileAsync?.(scene as unknown as Scene, warmupCamera) ??
            Promise.resolve())
        } catch {}

        recordNavigationPerfSample(
          'navigationRobot.renderWarmupCompileAsyncWallMs',
          performance.now() - warmupStart,
        )

        if (cancelled) {
          return
        }

        renderWarmupPass('navigationRobot.renderWarmupRenderMs')

        const liveWarmupRoot = rootGroupRef.current
        if (liveWarmupRoot) {
          const actorBodyProbeState = { hits: 0, meshName: null as string | null }
          const toolProbeState = { hits: 0, meshName: null as string | null }
          const bindWarmupSubmissionProbe = (
            predicate: (mesh: Mesh) => boolean,
            state: { hits: number; meshName: string | null },
          ) => {
            const targetMesh =
              collectMeshList(liveWarmupRoot).find((mesh) => predicate(mesh)) ?? null
            if (!targetMesh) {
              return () => {}
            }
            state.meshName = targetMesh.name || null
            const previousHandler = targetMesh.onBeforeRender
            targetMesh.onBeforeRender = (...args: unknown[]) => {
              state.hits += 1
              previousHandler(...(args as Parameters<NonNullable<typeof previousHandler>>))
            }
            return () => {
              targetMesh.onBeforeRender = previousHandler
            }
          }
          const cleanupActorBodyProbe = bindWarmupSubmissionProbe(
            (mesh) => (mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh === true,
            actorBodyProbeState,
          )
          const cleanupToolProbe = bindWarmupSubmissionProbe(
            (mesh) => hasAncestorNamed(mesh, 'navigation-robot-tool-left'),
            toolProbeState,
          )
          const liveMeshCullingEntries = collectMeshList(liveWarmupRoot).map((mesh) => ({
            frustumCulled: mesh.frustumCulled,
            mesh,
          }))
          const visibilityEntries: Array<{ object: Object3D; visible: boolean }> = []
          let current: Object3D | null = liveWarmupRoot
          while (current && current !== scene) {
            visibilityEntries.push({ object: current, visible: current.visible })
            current.visible = true
            current = current.parent
          }
          liveMeshCullingEntries.forEach(({ mesh }) => {
            mesh.frustumCulled = false
          })

          scene.updateMatrixWorld(true)

          const liveBounds = new Box3().setFromObject(liveWarmupRoot)
          if (!liveBounds.isEmpty()) {
            const liveCenter = new Vector3()
            const liveSize = new Vector3()
            liveBounds.getCenter(liveCenter)
            liveBounds.getSize(liveSize)

            warmupCamera.position.set(
              liveCenter.x,
              liveCenter.y + Math.max(0.6, liveSize.y * 0.4),
              liveCenter.z + Math.max(1.6, Math.max(liveSize.x, liveSize.z) * 1.8),
            )
            warmupCamera.lookAt(liveCenter.x, liveCenter.y + liveSize.y * 0.2, liveCenter.z)
            warmupCamera.updateProjectionMatrix()
            warmupCamera.updateMatrixWorld(true)

            const liveCompileStart = performance.now()
            try {
              await (renderer.compileAsync?.(scene as unknown as Scene, warmupCamera) ??
                Promise.resolve())
            } catch {}
            recordNavigationPerfSample(
              'navigationRobot.liveRenderWarmupCompileAsyncWallMs',
              performance.now() - liveCompileStart,
            )

            renderWarmupPass('navigationRobot.liveRenderWarmupRenderMs')

            const liveSceneCameraCompileStart = performance.now()
            try {
              await (renderer.compileAsync?.(
                scene as unknown as Scene,
                sceneCamera as unknown as Camera,
              ) ?? Promise.resolve())
            } catch {}
            recordNavigationPerfSample(
              'navigationRobot.liveSceneCameraWarmupCompileAsyncWallMs',
              performance.now() - liveSceneCameraCompileStart,
            )
            renderWarmupPass(
              'navigationRobot.liveSceneCameraWarmupRenderMs',
              sceneCamera as unknown as Camera,
            )

            const sampleLocomotionWarmup = (
              label: 'run' | 'walk',
              weights: { idle: number; run: number; walk: number },
            ) => {
              for (const action of allAnimationActions) {
                setActionInactive(action)
              }

              const applyActionPose = (action: AnimationAction | null, weight: number) => {
                if (!action || weight <= 1e-3) {
                  return
                }

                action.enabled = true
                action.clampWhenFinished = false
                if (!action.isRunning()) {
                  action.play()
                }
                action.paused = true
                action.time = action.getClip().duration * 0.25
                action.setEffectiveWeight(weight)
                action.setEffectiveTimeScale(0)
              }

              applyActionPose(idleAction, weights.idle)
              applyActionPose(walkAction, weights.walk)
              applyActionPose(runAction, weights.run)
              mixer.update(0)
              scene.updateMatrixWorld(true)

              renderWarmupPass(
                `navigationRobot.liveRenderWarmup${label === 'walk' ? 'Walk' : 'Run'}RenderMs`,
                sceneCamera as unknown as Camera,
              )
            }

            sampleLocomotionWarmup('walk', { idle: 0, run: 0, walk: 1 })
            sampleLocomotionWarmup('run', { idle: 0, run: 1, walk: 0 })
            for (const action of allAnimationActions) {
              setActionInactive(action)
            }
            mixer.update(0)
            scene.updateMatrixWorld(true)
            mergeNavigationPerfMeta({
              navigationRobotLiveWarmupActorBodyHits: actorBodyProbeState.hits,
              navigationRobotLiveWarmupActorBodyMeshName: actorBodyProbeState.meshName,
              navigationRobotLiveWarmupToolHits: toolProbeState.hits,
              navigationRobotLiveWarmupToolMeshName: toolProbeState.meshName,
            })
            recordNavigationPerfMark('navigationRobot.liveWarmupProbeSummary', {
              actorBodyHits: actorBodyProbeState.hits,
              actorBodyMeshName: actorBodyProbeState.meshName,
              toolHits: toolProbeState.hits,
              toolMeshName: toolProbeState.meshName,
            })
          }

          visibilityEntries.forEach(({ object, visible }) => {
            object.visible = visible
          })
          liveMeshCullingEntries.forEach(({ frustumCulled, mesh }) => {
            mesh.frustumCulled = frustumCulled
          })
          cleanupActorBodyProbe()
          cleanupToolProbe()
        }

        recordNavigationPerfSample(
          'navigationRobot.renderWarmupMs',
          performance.now() - warmupStart,
        )
        if (!cancelled) {
          window.clearTimeout(fallbackTimeoutId)
          recordNavigationPerfMark('navigationRobot.materialWarmupReady')
          setMaterialWarmupReady(true)
        }
      } catch {
      } finally {
        renderer.setRenderTarget?.(null)
        renderTarget.dispose()
        warmupRoots.forEach((root) => {
          warmupRoot.remove(root)
        })
        scene.remove(warmupRoot)
      }
    }

    void compileWarmup()

    return () => {
      cancelled = true
      window.clearTimeout(fallbackTimeoutId)
      materialWarmupQueuedRef.current = false
      // Cleanup in case the effect is interrupted before the render path removes the warmup roots.
      scene.children
        .filter((child) => child.name === '__pascalRobotWarmupRoot__')
        .forEach((child) => {
          scene.remove(child)
        })
    }
  }, [
    allAnimationActions,
    clonedScene,
    gl,
    idleAction,
    leftToolConeRenderables,
    leftToolRenderable,
    mixer,
    runAction,
    scene,
    showToolAttachments,
    walkAction,
  ])

  useEffect(() => {
    const bindRenderProbe = (mesh: Mesh, frameIdRef: MutableRefObject<number | null>) => {
      const previousHandler = mesh.onBeforeRender
      mesh.onBeforeRender = (...args) => {
        const frameId = toolConeFrameIdRef.current
        if (frameId > 0) {
          frameIdRef.current = frameId
          toolConeSubmittedAnyFrameIdRef.current = frameId
          toolConeLastSubmittedAtMsRef.current = performance.now()
        }
        previousHandler(...args)
      }

      return () => {
        mesh.onBeforeRender = previousHandler
      }
    }

    const cleanupMain = leftToolConeRenderables.map((toolConeRenderable) =>
      bindRenderProbe(toolConeRenderable.mainMesh, toolConeSubmittedMainFrameIdRef),
    )
    const cleanupInwardGlow = leftToolConeRenderables.map((toolConeRenderable) =>
      bindRenderProbe(toolConeRenderable.inwardGlowMesh, toolConeSubmittedInwardGlowFrameIdRef),
    )
    const cleanupOutwardGlow = leftToolConeRenderables.map((toolConeRenderable) =>
      bindRenderProbe(toolConeRenderable.outwardGlowMesh, toolConeSubmittedOutwardGlowFrameIdRef),
    )

    return () => {
      cleanupMain.forEach((cleanup) => {
        cleanup()
      })
      cleanupInwardGlow.forEach((cleanup) => {
        cleanup()
      })
      cleanupOutwardGlow.forEach((cleanup) => {
        cleanup()
      })
    }
  }, [leftToolConeRenderables])

  useEffect(() => {
    return () => {
      leftToolConeOverlayRenderable.mainGeometry.dispose()
      leftToolConeOverlayRenderable.outlineMesh.geometry.dispose()
      leftToolConeOverlayRenderable.inwardGlowMesh.geometry.dispose()
      leftToolConeOverlayRenderable.outwardGlowMesh.geometry.dispose()
      leftToolConeOccludedRenderable.mainGeometry.dispose()
      leftToolConeOccludedRenderable.outlineMesh.geometry.dispose()
      leftToolConeOccludedRenderable.inwardGlowMesh.geometry.dispose()
      leftToolConeOccludedRenderable.outwardGlowMesh.geometry.dispose()
      leftToolConeMaterial.dispose()
      leftToolConeOutlineMaterial.dispose()
      leftToolConeInwardGlowMaterial.dispose()
      leftToolConeOutwardGlowMaterial.dispose()
      leftToolConeOccludedMaterial.dispose()
      leftToolConeOccludedOutlineMaterial.dispose()
      leftToolConeOccludedInwardGlowMaterial.dispose()
      leftToolConeOccludedOutwardGlowMaterial.dispose()
      setToolConeIsolatedOverlay(null)
    }
  }, [
    leftToolConeOccludedInwardGlowMaterial,
    leftToolConeOccludedMaterial,
    leftToolConeOccludedOutlineMaterial,
    leftToolConeOccludedOutwardGlowMaterial,
    leftToolConeOccludedRenderable,
    leftToolConeInwardGlowMaterial,
    leftToolConeMaterial,
    leftToolConeOutlineMaterial,
    leftToolConeOutwardGlowMaterial,
    leftToolConeOverlayRenderable,
  ])

  useEffect(() => {
    mixer.timeScale = animationPaused ? 0 : 1
  }, [animationPaused, mixer])

  useLayoutEffect(() => {
    let meshCount = 0
    let skinnedMeshCount = 0
    let triangleCount = 0
    const debugBoneSamples: DebugBoneSample[] = []
    const shoulderBones: Partial<Record<ShoulderBoneName, Object3D>> = {}
    let leftHandBone: Object3D | null = null
    const revealMaterialBindings: RevealMaterialBinding[] = []
    const revealMaterialEntries: RevealMaterialEntry[] = []
    const initialRevealProgress = initialSceneRevealProgressRef.current

    measureNavigationPerf('navigationRobot.sceneSetupMs', () => {
      clonedScene.traverse((child) => {
        child.visible = true

        const geometryHolder = child as {
          geometry?: {
            getAttribute?: (name: string) => { count: number } | undefined
            getIndex?: () => { count: number } | null
          }
        }

        if (geometryHolder.geometry) {
          meshCount += 1
          const positionAttribute = geometryHolder.geometry.getAttribute?.('position')
          if (positionAttribute) {
            const indexCount = geometryHolder.geometry.getIndex?.()?.count
            triangleCount += indexCount ? indexCount / 3 : positionAttribute.count / 3
          }
        }

        if ('isSkinnedMesh' in child && child.isSkinnedMesh) {
          skinnedMeshCount += 1
        }

        if (
          NAVIGATION_ROBOT_DEBUG_ENABLED &&
          'isBone' in child &&
          child.isBone &&
          debugBoneSamples.length < 16
        ) {
          debugBoneSamples.push({
            bone: child as Object3D,
            name: child.name || `bone-${debugBoneSamples.length}`,
            previousPosition: child.position.clone(),
            previousQuaternion: child.quaternion.clone(),
          })
        }

        if ('isBone' in child && child.isBone) {
          for (const shoulderBoneName of SHOULDER_BONE_NAMES) {
            if (!shoulderBones[shoulderBoneName] && child.name === shoulderBoneName) {
              shoulderBones[shoulderBoneName] = child as Object3D
            }
          }
          if (!leftHandBone) {
            for (const leftHandBoneName of LEFT_HAND_BONE_NAMES) {
              if (child.name === leftHandBoneName) {
                leftHandBone = child as Object3D
                break
              }
            }
          }
          if (!leftHandBone) {
            const normalizedName = child.name.replaceAll(/[^a-z]/gi, '').toLowerCase()
            if (normalizedName.includes('lefthand')) {
              leftHandBone = child as Object3D
            }
          }
        }

        if ('isMesh' in child && child.isMesh) {
          const mesh = child as Mesh
          mesh.userData.pascalExcludeFromOutline = true
          if (mesh.material) {
            const originalMaterial = cloneObjectMaterials(mesh.material as Material | Material[])
            const revealMaterial = cloneObjectMaterials(originalMaterial)
            normalizeRobotBaseMaterials(originalMaterial)
            normalizeRobotRevealMaterials(revealMaterial)
            const revealMaterialList = Array.isArray(revealMaterial)
              ? revealMaterial
              : [revealMaterial]
            const bindings: RevealMaterialBinding[] = []
            for (const material of revealMaterialList) {
              const revealMaterialBinding = createRevealMaterialBinding(material, 0, 1)
              revealMaterialBinding.uniforms.revealProgress.value = initialRevealProgress
              revealMaterialBindings.push(revealMaterialBinding)
              bindings.push(revealMaterialBinding)
            }
            revealMaterialEntries.push({
              bindings,
              mesh,
              originalMaterial,
              revealMaterial,
            })
            mesh.material = initialRevealProgress < 1 - 1e-3 ? revealMaterial : originalMaterial
          }
        }

        if ('isMesh' in child && child.isMesh) {
          child.castShadow = false
          child.receiveShadow = false
          child.frustumCulled = false
          child.renderOrder = 36
        }
      })
    })
    debugBoneSamplesRef.current = debugBoneSamples
    shoulderBonesRef.current = shoulderBones
    leftShoulderFollowBoneRef.current = findAttachmentTargetByTokens(
      clonedScene,
      LEFT_SHOULDER_BONE_NAMES,
      ['leftshoulder'],
    )
    leftUpperArmBoneRef.current = findAttachmentTargetByTokens(
      clonedScene,
      LEFT_UPPER_ARM_BONE_NAMES,
      ['leftarm'],
    )
    leftElbowBoneRef.current = findAttachmentTargetByTokens(clonedScene, LEFT_ELBOW_BONE_NAMES, [
      'leftforearm',
    ])
    leftHandBoneRef.current = leftHandBone
    revealMaterialBindingsRef.current = revealMaterialBindings
    revealMaterialEntriesRef.current = revealMaterialEntries
    revealMaterialsActiveRef.current = initialRevealProgress < 1 - 1e-3

    mergeNavigationPerfMeta({
      navigationRobotClipCount: animations.length,
      navigationRobotMeshCount: meshCount,
      navigationRobotSkinnedMeshCount: skinnedMeshCount,
      navigationRobotTriangleCount: triangleCount,
    })

    if (NAVIGATION_ROBOT_DEBUG_ENABLED && typeof window !== 'undefined') {
      const bounds = new Box3().setFromObject(clonedScene)
      const size = bounds.getSize(new Vector3())
      writeRobotDebugState(debugId, debugStateRef, {
        availableClipNames: animations.map((clip) => clip.name),
        effectiveClipOverrides: resolvedClipOverrides,
        materialWarmupReady,
        rawBounds: {
          max: [bounds.max.x, bounds.max.y, bounds.max.z],
          min: [bounds.min.x, bounds.min.y, bounds.min.z],
          size: [size.x, size.y, size.z],
        },
        robotScale: robotTransform.scale,
        sampleBoneNames: debugBoneSamples.map((sample) => sample.name),
      })
    }

    return () => {
      for (const entry of revealMaterialEntries) {
        disposeObjectMaterials(entry.originalMaterial)
        disposeObjectMaterials(entry.revealMaterial)
      }
      revealMaterialBindingsRef.current = []
      revealMaterialEntriesRef.current = []
      revealMaterialsActiveRef.current = false
    }
  }, [animations, clonedScene, debugId, debugStateRef, resolvedClipOverrides, robotTransform.scale])

  useLayoutEffect(() => {
    const revealMaterialBindings: RevealMaterialBinding[] = []
    const revealMaterialEntries: RevealMaterialEntry[] = []
    const initialRevealProgress = forcedClipPlayback?.revealFromStart ? 0 : 1

    measureNavigationPerf('navigationRobot.toolSceneSetupMs', () => {
      computeRobotRevealBounds(
        leftToolRenderable,
        toolRevealBoundsRef.current,
        toolRevealBoundsScratchRef.current,
      )
      const revealBounds = toolRevealBoundsRef.current
      const revealMinY = revealBounds.isEmpty() ? 0 : revealBounds.min.y
      const revealMaxY = revealBounds.isEmpty() ? 1 : revealBounds.max.y

      leftToolRenderable.traverse((child) => {
        const mesh = child as Mesh
        if (!mesh.isMesh || !mesh.material) {
          return
        }
        if (isExcludedFromToolReveal(mesh)) {
          return
        }
        const originalMaterial = cloneObjectMaterials(mesh.material as Material | Material[])
        const revealMaterial = cloneObjectMaterials(originalMaterial)
        normalizeRobotBaseMaterials(originalMaterial)
        normalizeRobotRevealMaterials(revealMaterial)
        const revealMaterialList = Array.isArray(revealMaterial) ? revealMaterial : [revealMaterial]
        const bindings: RevealMaterialBinding[] = []
        for (const material of revealMaterialList) {
          const revealMaterialBinding = createRevealMaterialBinding(
            material,
            revealMinY,
            revealMaxY,
          )
          revealMaterialBinding.uniforms.revealProgress.value = initialRevealProgress
          revealMaterialBindings.push(revealMaterialBinding)
          bindings.push(revealMaterialBinding)
        }
        revealMaterialEntries.push({
          bindings,
          mesh,
          originalMaterial,
          revealMaterial,
        })
        mesh.material = initialRevealProgress < 1 - 1e-3 ? revealMaterial : originalMaterial
      })
    })

    toolRevealMaterialBindingsRef.current = revealMaterialBindings
    toolRevealMaterialEntriesRef.current = revealMaterialEntries
    toolRevealMaterialsActiveRef.current = initialRevealProgress < 1 - 1e-3

    return () => {
      for (const entry of revealMaterialEntries) {
        disposeObjectMaterials(entry.originalMaterial)
        disposeObjectMaterials(entry.revealMaterial)
      }
      toolRevealMaterialBindingsRef.current = []
      toolRevealMaterialEntriesRef.current = []
      toolRevealMaterialsActiveRef.current = false
    }
  }, [leftToolRenderable])

  useEffect(() => {
    rootMotionBoneRef.current = findRootMotionBone(clonedScene)
    scene.updateMatrixWorld(true)
    const referenceRootMotionBonePosition =
      findRootMotionBone(scene)?.getWorldPosition(new Vector3()) ?? null
    if (!referenceRootMotionBonePosition) {
      rootMotionBaselineScenePositionRef.current = null
      motionRef.current.rootMotionOffset = [0, 0, 0]
      return
    }

    rootMotionBaselineScenePositionRef.current = referenceRootMotionBonePosition
    motionRef.current.rootMotionOffset = [0, 0, 0]
  }, [clonedScene, motionRef, scene])

  useEffect(() => {
    if (!clonedScene) {
      readySignalKeyRef.current = null
      return
    }
    if (!materialWarmupReady) {
      return
    }

    const readySignalKey = `${clonedScene.uuid}:${forcedClipPlaybackKey ?? 'base'}`
    if (readySignalKeyRef.current === readySignalKey) {
      return
    }

    readySignalKeyRef.current = readySignalKey
    recordNavigationPerfMark('navigationRobot.onReady')
    onReady?.()
  }, [clonedScene, forcedClipPlaybackKey, materialWarmupReady, onReady])

  useFrame(() => {
    const leftHandBone = leftHandBoneRef.current
    if (!(leftHandBone && checkoutLeftHandRestorePendingRef.current)) {
      return
    }

    leftHandBone.quaternion.copy(checkoutLeftHandBaseQuaternionRef.current)
    leftHandBone.updateMatrixWorld(true)
    checkoutLeftHandRestorePendingRef.current = false
  }, -100)

  useEffect(() => {
    const initialRevealProgress = forcedClipPlayback?.revealFromStart ? 0 : 1
    visualRevealProgressRef.current = initialRevealProgress
    toolVisualRevealProgressRef.current = initialRevealProgress
    revealBoundsRef.current.makeEmpty()
    for (const binding of revealMaterialBindingsRef.current) {
      binding.uniforms.revealProgress.value = initialRevealProgress
      binding.webgpuUniforms.revealProgress.value = initialRevealProgress
    }
    const revealMaterialsShouldBeActive = resolveRevealMaterialsShouldBeActive(
      initialRevealProgress < 1 - 1e-3,
    )
    if (revealMaterialsActiveRef.current !== revealMaterialsShouldBeActive) {
      for (const entry of revealMaterialEntriesRef.current) {
        entry.mesh.material = revealMaterialsShouldBeActive
          ? entry.revealMaterial
          : entry.originalMaterial
      }
      revealMaterialsActiveRef.current = revealMaterialsShouldBeActive
      recordNavigationPerfMark('navigationRobot.revealMaterialModeSwitch', {
        materialDebugMode,
        revealMaterialsActive: revealMaterialsShouldBeActive,
        toolRevealMaterialsActive: toolRevealMaterialsActiveRef.current,
        trigger: 'initial',
      })
    }
    for (const binding of toolRevealMaterialBindingsRef.current) {
      binding.uniforms.revealProgress.value = initialRevealProgress
      binding.webgpuUniforms.revealProgress.value = initialRevealProgress
    }
    const toolRevealMaterialsShouldBeActive = resolveRevealMaterialsShouldBeActive(
      initialRevealProgress < 1 - 1e-3,
    )
    if (toolRevealMaterialsActiveRef.current !== toolRevealMaterialsShouldBeActive) {
      for (const entry of toolRevealMaterialEntriesRef.current) {
        entry.mesh.material = toolRevealMaterialsShouldBeActive
          ? entry.revealMaterial
          : entry.originalMaterial
      }
      toolRevealMaterialsActiveRef.current = toolRevealMaterialsShouldBeActive
      recordNavigationPerfMark('navigationRobot.toolRevealMaterialModeSwitch', {
        materialDebugMode,
        revealMaterialsActive: revealMaterialsActiveRef.current,
        toolRevealMaterialsActive: toolRevealMaterialsShouldBeActive,
        trigger: 'initial',
      })
    }

    if (forcedClipPlaybackKey === null) {
      return
    }

    previousForcedClipActionRef.current = null
    const releasedForcedAction = releasedForcedActionRef.current
    if (releasedForcedAction) {
      releasedForcedAction.clampWhenFinished = false
      releasedForcedAction.paused = false
      releasedForcedAction.setEffectiveTimeScale(1)
      releasedForcedAction.stop()
    }
    releasedForcedActionRef.current = null
    releasedForcedWeightRef.current = 0
  }, [
    debugTransitionPreviewClipName,
    forcedClipPlayback?.revealFromStart,
    forcedClipPlaybackKey,
    materialDebugMode,
    resolveRevealMaterialsShouldBeActive,
  ])

  useEffect(() => {
    if (allAnimationActions.length === 0) {
      activeClipNameRef.current = null
      return
    }

    measureNavigationPerf('navigationRobot.clipSetupMs', () => {
      for (const action of allAnimationActions) {
        action.stop()
        action.enabled = false
        action.clampWhenFinished = false
        action.paused = false
        action.setEffectiveWeight(0)
        action.setEffectiveTimeScale(1)
      }

      if (active) {
        for (const action of locomotionActions) {
          action.enabled = true
          action.reset().setLoop(LoopRepeat, Infinity)
          action.paused = false
          action.setEffectiveTimeScale(action === idleAction ? IDLE_TIME_SCALE : 1)
          action.setEffectiveWeight(action === idleAction ? 1 : 0)
          action.play()
        }
      }
    })

    animationBlendStateRef.current = {
      idleWeight: idleAction ? 1 : 0,
      runTimeScale: 1,
      runWeight: 0,
      walkTimeScale: 1,
      walkWeight: 0,
    }
    activeClipNameRef.current = active
      ? (idleAction?.getClip().name ??
        walkAction?.getClip().name ??
        runAction?.getClip().name ??
        null)
      : null
    mergeNavigationPerfMeta({
      navigationRobotActiveClip: activeClipNameRef.current,
    })

    return () => {
      for (const action of allAnimationActions) {
        action.stop()
        action.enabled = false
      }
    }
  }, [active, allAnimationActions, idleAction, locomotionActions, runAction, walkAction])

  useEffect(() => {
    if (!(forcedClipPlayback && forcedClipAction)) {
      return
    }

    const loopMode = forcedClipPlayback.loop === 'once' ? LoopOnce : LoopRepeat
    forcedClipAction.enabled = true
    forcedClipAction.clampWhenFinished = Boolean(
      forcedClipPlayback.loop === 'once' && forcedClipPlayback.holdLastFrame,
    )
    forcedClipAction.reset()
    forcedClipAction.setLoop(loopMode, forcedClipPlayback.loop === 'once' ? 1 : Infinity)
    forcedClipAction.paused = false
    forcedClipAction.setEffectiveWeight(1)
    forcedClipAction.setEffectiveTimeScale(Math.max(0.01, forcedClipPlayback.timeScale ?? 1))
    forcedClipAction.play()

    return () => {
      forcedClipAction.clampWhenFinished = false
    }
  }, [forcedClipAction, forcedClipPlaybackKey])

  const updateToolConeOverlay = (
    camera: Camera,
    toolInteractionTargetItemId: string | null,
    toolInteractionPhase: NavigationRobotToolInteractionPhase | null,
    toolInteractionClipTime: number | null,
    hasCarryTarget: boolean,
    carryContinuationVisible: boolean,
    rawCarryTargetPresent: boolean,
    captureDebugPayload: boolean,
  ) => {
    const toolConeGroupAttached = Boolean(leftToolRenderable.parent)

    for (const toolConeRenderable of leftToolConeRenderables) {
      toolConeRenderable.mainMesh.visible = false
      toolConeRenderable.inwardGlowMesh.visible = false
      toolConeRenderable.outlineMesh.visible = false
      toolConeRenderable.outwardGlowMesh.visible = false
    }

    const logicExpectedVisible = Boolean(
      toolConeGroupAttached &&
        toolInteractionTargetItemId &&
        shouldShowToolConeOverlay(toolInteractionClipTime, hasCarryTarget),
    )

    let toolConeDebugPayload: Record<string, unknown> | null = captureDebugPayload
      ? {
          active: false,
          carryContinuationVisible,
          clipTime: toolInteractionClipTime,
          geometryMissStreakFrames: toolConeGeometryMissStreakFramesRef.current,
          groupAttached: toolConeGroupAttached,
          interactionPhase: toolInteractionPhase,
          logicExpectedVisible,
          overlayGateCarryVisible: hasCarryTarget,
          previousFrameLogicExpectedVisible: toolConePreviousFrameLogicExpectedRef.current,
          previousFrameRenderSubmitted: toolConePreviousFrameSubmittedAnyRef.current,
          previousFrameSubmittedInwardGlow: toolConePreviousFrameSubmittedInwardGlowRef.current,
          previousFrameSubmittedMain: toolConePreviousFrameSubmittedMainRef.current,
          previousFrameSubmittedOutwardGlow: toolConePreviousFrameSubmittedOutwardGlowRef.current,
          previousFrameVisible: toolConePreviousFrameVisibleRef.current,
          renderFailureStreakFrames: toolConeFailureStreakFramesRef.current,
          renderLastSubmittedAtMs: toolConeLastSubmittedAtMsRef.current,
          renderMissStreakFrames: toolConeRenderMissStreakFramesRef.current,
          rawCarryTargetPresent,
          targetItemId: toolInteractionTargetItemId,
          visibleEndTime: TOOL_CONE_VISIBLE_END_TIME,
          visibleStartTime: TOOL_CONE_VISIBLE_START_TIME,
          visible: false,
        }
      : null

    if (!logicExpectedVisible) {
      toolConeFrozenHullTargetItemIdRef.current = null
      toolConeFrozenHullPointsRef.current = []
      setToolConeIsolatedOverlay(null)
      return toolConeDebugPayload
    }

    toolConeLogicExpectedFrameIdRef.current = toolConeFrameIdRef.current

    camera.updateMatrixWorld(true)
    leftToolRenderable.updateWorldMatrix(true, true)

    const targetItemId = toolInteractionTargetItemId
    if (!targetItemId) {
      setToolConeIsolatedOverlay(null)
      return toolConeDebugPayload
    }

    const toolInteractionTarget = sceneRegistry.nodes.get(targetItemId)
    if (!toolInteractionTarget) {
      setToolConeIsolatedOverlay(null)
      return toolConeDebugPayload
    }

    applyLiveTransformToSceneObject(targetItemId, toolInteractionTarget)
    toolInteractionTarget.updateWorldMatrix(true, true)

    const shouldFreezeTargetHull = Boolean(toolInteractionPhase && targetItemId)
    const frozenHullPoints = toolConeFrozenHullPointsRef.current
    if (!shouldFreezeTargetHull) {
      toolConeFrozenHullTargetItemIdRef.current = null
      frozenHullPoints.length = 0
    } else if (toolConeFrozenHullTargetItemIdRef.current !== targetItemId) {
      if (frozenHullPoints.length > 0) {
        for (const frozenHullPoint of frozenHullPoints) {
          frozenHullPoint.targetLocalPoint.copy(frozenHullPoint.worldPoint)
          toolInteractionTarget.worldToLocal(frozenHullPoint.targetLocalPoint)
        }
      }
      toolConeFrozenHullTargetItemIdRef.current = targetItemId
    }

    const projectedHullCandidates = toolConeProjectedHullCandidatesRef.current
    projectedHullCandidates.length = 0

    toolConeApexLocalPointRef.current.set(
      TOOL_CONE_TOOL_CORNER_OFFSET.x,
      TOOL_CONE_TOOL_CORNER_OFFSET.y,
      TOOL_CONE_TOOL_CORNER_OFFSET.z,
    )
    toolConeApexWorldPointRef.current.copy(toolConeApexLocalPointRef.current)
    leftToolRenderable.localToWorld(toolConeApexWorldPointRef.current)
    toolConeHullProjectedPointScratchRef.current
      .copy(toolConeApexWorldPointRef.current)
      .project(camera)
    projectedHullCandidates.push({
      cameraSnapped: false,
      cameraSurfaceDistanceDelta: null,
      cameraSurfaceMeshName: null,
      cameraSurfacePoint: null,
      cameraSurfaceRelation: undefined,
      isApex: true,
      localPoint: toolConeApexLocalPointRef.current.clone(),
      projectedPoint: new Vector2(
        toolConeHullProjectedPointScratchRef.current.x,
        toolConeHullProjectedPointScratchRef.current.y,
      ),
      sourceMeshName: null,
      sourceMeshVisible: null,
      supportIndex: null,
      worldPoint: toolConeApexWorldPointRef.current.clone(),
    })

    let projectedHull: ProjectedHullCandidate[] = []
    if (shouldFreezeTargetHull && frozenHullPoints.length > 0) {
      for (
        let frozenHullIndex = 0;
        frozenHullIndex < frozenHullPoints.length;
        frozenHullIndex += 1
      ) {
        const frozenHullPoint = frozenHullPoints[frozenHullIndex]
        if (!frozenHullPoint) {
          continue
        }
        const supportWorldPoint = toolConeFrozenHullWorldPointScratchRef.current.copy(
          frozenHullPoint.targetLocalPoint,
        )
        toolInteractionTarget.localToWorld(supportWorldPoint)
        frozenHullPoint.worldPoint.copy(supportWorldPoint)
        const supportLocalPoint =
          toolConeSupportLocalPointsRef.current[frozenHullIndex]?.copy(supportWorldPoint)
        if (!supportLocalPoint) {
          continue
        }

        leftToolRenderable.worldToLocal(supportLocalPoint)
        toolConeHullProjectedPointScratchRef.current.copy(supportWorldPoint).project(camera)
        if (
          !Number.isFinite(toolConeHullProjectedPointScratchRef.current.x) ||
          !Number.isFinite(toolConeHullProjectedPointScratchRef.current.y)
        ) {
          continue
        }

        projectedHullCandidates.push({
          cameraSnapped: frozenHullPoint.cameraSnapped,
          cameraSurfaceDistanceDelta: frozenHullPoint.cameraSurfaceDistanceDelta,
          cameraSurfaceMeshName: frozenHullPoint.cameraSurfaceMeshName,
          cameraSurfacePoint: frozenHullPoint.cameraSurfacePoint,
          cameraSurfaceRelation: frozenHullPoint.cameraSurfaceRelation ?? undefined,
          isApex: false,
          localPoint: supportLocalPoint.clone(),
          projectedPoint: new Vector2(
            toolConeHullProjectedPointScratchRef.current.x,
            toolConeHullProjectedPointScratchRef.current.y,
          ),
          sourceMeshName: frozenHullPoint.sourceMeshName,
          sourceMeshVisible: frozenHullPoint.sourceMeshVisible,
          supportIndex: frozenHullPoint.supportIndex,
          worldPoint: supportWorldPoint.clone(),
        })
      }
      projectedHull = reorderHullFromApex(computeProjectedHull(projectedHullCandidates))
    } else {
      if (
        !collectTargetSupportPoints(
          toolInteractionTarget,
          toolConeSupportWorldPointsRef.current,
          toolConeScratchPointRef.current,
          toolConeSupportScoresRef.current,
          NAVIGATION_ROBOT_VERBOSE_DEBUG_ENABLED
            ? toolConeSupportDiagnosticsRef.current
            : undefined,
        )
      ) {
        setToolConeIsolatedOverlay(null)
        return {
          ...toolConeDebugPayload,
          active: true,
          collectSuccess: false,
          frozenTargetHull: frozenHullPoints.length > 0,
          visible: false,
        }
      }

      for (let index = 0; index < toolConeSupportWorldPointsRef.current.length; index += 1) {
        const supportWorldPoint = toolConeSupportWorldPointsRef.current[index]
        const supportLocalTarget = toolConeSupportLocalPointsRef.current[index]
        const supportDiagnostic = toolConeSupportDiagnosticsRef.current[index]
        if (!supportWorldPoint || !supportLocalTarget) {
          continue
        }

        const supportLocalPoint = supportLocalTarget.copy(supportWorldPoint)
        leftToolRenderable.worldToLocal(supportLocalPoint)
        toolConeHullProjectedPointScratchRef.current.copy(supportWorldPoint).project(camera)
        if (
          !Number.isFinite(toolConeHullProjectedPointScratchRef.current.x) ||
          !Number.isFinite(toolConeHullProjectedPointScratchRef.current.y)
        ) {
          continue
        }

        projectedHullCandidates.push({
          cameraSnapped: supportDiagnostic?.cameraSnapped ?? false,
          cameraSurfaceDistanceDelta: supportDiagnostic?.cameraSurfaceDistanceDelta ?? null,
          cameraSurfaceMeshName: supportDiagnostic?.cameraSurfaceMeshName ?? null,
          cameraSurfacePoint: supportDiagnostic?.cameraSurfacePoint ?? null,
          cameraSurfaceRelation: supportDiagnostic?.cameraSurfaceRelation,
          isApex: false,
          localPoint: supportLocalPoint.clone(),
          projectedPoint: new Vector2(
            toolConeHullProjectedPointScratchRef.current.x,
            toolConeHullProjectedPointScratchRef.current.y,
          ),
          sourceMeshName: supportDiagnostic?.sourceMeshName ?? null,
          sourceMeshVisible: supportDiagnostic?.sourceMeshVisible ?? null,
          supportIndex: index,
          worldPoint: supportWorldPoint.clone(),
        })
      }

      projectedHull = reorderHullFromApex(computeProjectedHull(projectedHullCandidates))
      if (shouldFreezeTargetHull && projectedHull.length >= 3) {
        toolConeFrozenHullTargetItemIdRef.current = targetItemId
        toolConeFrozenHullPointsRef.current = projectedHullCandidates
          .filter((candidate) => !candidate.isApex)
          .map((candidate) => {
            const targetLocalPoint = candidate.worldPoint.clone()
            toolInteractionTarget.worldToLocal(targetLocalPoint)
            return {
              cameraSnapped: candidate.cameraSnapped ?? false,
              cameraSurfaceDistanceDelta: candidate.cameraSurfaceDistanceDelta ?? null,
              cameraSurfaceMeshName: candidate.cameraSurfaceMeshName ?? null,
              cameraSurfacePoint: candidate.cameraSurfacePoint ?? null,
              cameraSurfaceRelation: candidate.cameraSurfaceRelation ?? null,
              sourceMeshName: candidate.sourceMeshName,
              sourceMeshVisible: candidate.sourceMeshVisible,
              supportIndex: candidate.supportIndex,
              targetLocalPoint,
              worldPoint: candidate.worldPoint.clone(),
            }
          })
      }
    }

    if (projectedHull.length < 3) {
      if (frozenHullPoints.length > 0) {
        toolConeFrozenHullTargetItemIdRef.current = null
        frozenHullPoints.length = 0
      }
      setToolConeIsolatedOverlay(null)
      return toolConeDebugPayload
    }

    setToolConeIsolatedOverlay({
      apexWorldPoint: vector3ToTuple(toolConeApexWorldPointRef.current),
      color: toolConeColor,
      hullPoints: projectedHull.map((hullPoint) => ({
        isApex: hullPoint.isApex,
        worldPoint: vector3ToTuple(hullPoint.worldPoint),
      })),
      supportWorldPoints: projectedHullCandidates
        .filter((candidate) => !candidate.isApex)
        .map((candidate) => vector3ToTuple(candidate.worldPoint)),
      visible: true,
    })
    toolConeVisibleFrameIdRef.current = toolConeFrameIdRef.current

    if (!captureDebugPayload) {
      return null
    }

    const baseToolConeDebugPayload = {
      active: true,
      apexLocalPoint: vector3ToTuple(toolConeApexLocalPointRef.current),
      apexWorldPoint: vector3ToTuple(toolConeApexWorldPointRef.current),
      carryContinuationVisible,
      clipTime: toolInteractionClipTime,
      geometryMissStreakFrames: toolConeGeometryMissStreakFramesRef.current,
      groupAttached: toolConeGroupAttached,
      hullPointCount: projectedHull.length,
      interactionPhase: toolInteractionPhase,
      logicExpectedVisible,
      overlayGateCarryVisible: hasCarryTarget,
      previousFrameLogicExpectedVisible: toolConePreviousFrameLogicExpectedRef.current,
      previousFrameRenderSubmitted: toolConePreviousFrameSubmittedAnyRef.current,
      previousFrameSubmittedInwardGlow: toolConePreviousFrameSubmittedInwardGlowRef.current,
      previousFrameSubmittedMain: toolConePreviousFrameSubmittedMainRef.current,
      previousFrameSubmittedOutwardGlow: toolConePreviousFrameSubmittedOutwardGlowRef.current,
      previousFrameVisible: toolConePreviousFrameVisibleRef.current,
      rawCarryTargetPresent,
      renderFailureStreakFrames: toolConeFailureStreakFramesRef.current,
      renderLastSubmittedAtMs: toolConeLastSubmittedAtMsRef.current,
      renderMissStreakFrames: toolConeRenderMissStreakFramesRef.current,
      supportPointCount: projectedHullCandidates.length,
      targetItemId: toolInteractionTargetItemId,
      targetObjectName: toolInteractionTarget.name || toolInteractionTarget.type,
      frozenTargetHull: shouldFreezeTargetHull,
      visibleEndTime: TOOL_CONE_VISIBLE_END_TIME,
      visibleStartTime: TOOL_CONE_VISIBLE_START_TIME,
      visible: true,
    }

    if (!NAVIGATION_ROBOT_VERBOSE_DEBUG_ENABLED) {
      return baseToolConeDebugPayload
    }

    const supportDebugPoints = projectedHullCandidates.map((candidate) => ({
      cameraSnapped: candidate.cameraSnapped ?? false,
      cameraSurfaceDistanceDelta: candidate.cameraSurfaceDistanceDelta ?? null,
      cameraSurfaceMeshName: candidate.cameraSurfaceMeshName ?? null,
      cameraSurfacePoint: candidate.cameraSurfacePoint ?? null,
      cameraSurfaceRelation: candidate.cameraSurfaceRelation ?? null,
      projectedPoint: vector2ToTuple(candidate.projectedPoint),
      sourceMeshName: candidate.sourceMeshName,
      sourceMeshVisible: candidate.sourceMeshVisible,
      supportIndex: candidate.supportIndex,
      worldPoint: vector3ToTuple(candidate.worldPoint),
    }))

    return {
      ...baseToolConeDebugPayload,
      hullPoints: projectedHull.map((hullPoint) => {
        toolConeRenderedWorldPointScratchRef.current.copy(hullPoint.localPoint)
        leftToolRenderable.localToWorld(toolConeRenderedWorldPointScratchRef.current)
        return {
          cameraSnapped: hullPoint.cameraSnapped ?? false,
          cameraSurfaceDistanceDelta: hullPoint.cameraSurfaceDistanceDelta ?? null,
          cameraSurfaceMeshName: hullPoint.cameraSurfaceMeshName ?? null,
          cameraSurfacePoint: hullPoint.cameraSurfacePoint ?? null,
          cameraSurfaceRelation: hullPoint.cameraSurfaceRelation ?? null,
          isApex: hullPoint.isApex,
          projectedPoint: vector2ToTuple(hullPoint.projectedPoint),
          renderedWorldPoint: vector3ToTuple(toolConeRenderedWorldPointScratchRef.current),
          sourceMeshName: hullPoint.sourceMeshName,
          sourceMeshVisible: hullPoint.sourceMeshVisible,
          supportIndex: hullPoint.supportIndex,
          worldAlignmentError: hullPoint.isApex
            ? 0
            : toolConeRenderedWorldPointScratchRef.current.distanceTo(hullPoint.worldPoint),
          worldPoint: vector3ToTuple(hullPoint.worldPoint),
        }
      }),
      supportPointCount: supportDebugPoints.length,
      supportPoints: supportDebugPoints,
    }
  }

  useFrame(({ camera }, delta) => {
    const frameStart = performance.now()
    const frameDelta = animationPaused ? 0 : delta
    const toolConeFrameId = toolConeFrameIdRef.current + 1
    toolConeFrameIdRef.current = toolConeFrameId
    const previousToolConeFrameId = toolConeFrameId - 1
    const previousFrameLogicExpectedVisible =
      toolConeLogicExpectedFrameIdRef.current === previousToolConeFrameId
    const previousFrameVisible = toolConeVisibleFrameIdRef.current === previousToolConeFrameId
    const previousFrameSubmittedAny =
      toolConeSubmittedAnyFrameIdRef.current === previousToolConeFrameId
    const previousFrameSubmittedMain =
      toolConeSubmittedMainFrameIdRef.current === previousToolConeFrameId
    const previousFrameSubmittedInwardGlow =
      toolConeSubmittedInwardGlowFrameIdRef.current === previousToolConeFrameId
    const previousFrameSubmittedOutwardGlow =
      toolConeSubmittedOutwardGlowFrameIdRef.current === previousToolConeFrameId
    toolConePreviousFrameLogicExpectedRef.current = previousFrameLogicExpectedVisible
    toolConePreviousFrameVisibleRef.current = previousFrameVisible
    toolConePreviousFrameSubmittedAnyRef.current = previousFrameSubmittedAny
    toolConePreviousFrameSubmittedMainRef.current = previousFrameSubmittedMain
    toolConePreviousFrameSubmittedInwardGlowRef.current = previousFrameSubmittedInwardGlow
    toolConePreviousFrameSubmittedOutwardGlowRef.current = previousFrameSubmittedOutwardGlow
    const shouldCaptureRobotDebugState =
      shouldWriteRobotDebugState(debugId) &&
      frameStart - lastRobotDebugPublishAt >= ROBOT_DEBUG_PUBLISH_INTERVAL_MS
    if (shouldCaptureRobotDebugState) {
      lastRobotDebugPublishAt = frameStart
    }
    if (previousFrameLogicExpectedVisible) {
      if (previousFrameVisible && previousFrameSubmittedAny) {
        toolConeFailureStreakFramesRef.current = 0
      } else {
        toolConeFailureStreakFramesRef.current += 1
      }

      if (previousFrameVisible) {
        toolConeGeometryMissStreakFramesRef.current = 0
      } else {
        toolConeGeometryMissStreakFramesRef.current += 1
      }

      if (previousFrameVisible && !previousFrameSubmittedAny) {
        toolConeRenderMissStreakFramesRef.current += 1
      } else {
        toolConeRenderMissStreakFramesRef.current = 0
      }
    } else {
      toolConeFailureStreakFramesRef.current = 0
      toolConeGeometryMissStreakFramesRef.current = 0
      toolConeRenderMissStreakFramesRef.current = 0
    }
    const leftHandBone = leftHandBoneRef.current
    for (const toolConeRenderable of leftToolConeRenderables) {
      toolConeRenderable.mainMesh.visible = false
      toolConeRenderable.inwardGlowMesh.visible = false
      toolConeRenderable.outlineMesh.visible = false
      toolConeRenderable.outwardGlowMesh.visible = false
    }

    const toolInteractionTargetItemId =
      toolInteractionTargetItemIdRef?.current ??
      toolCarryItemIdRef?.current ??
      toolCarryItemId ??
      null
    const toolCarryTargetItemId = toolCarryItemIdRef?.current ?? toolCarryItemId ?? null
    const toolInteractionPhase = toolInteractionPhaseRef?.current ?? null
    const toolInteractionClipTime =
      motionRef.current.forcedClip?.clipName === CHECKOUT_CLIP_NAME
        ? (motionRef.current.forcedClip.seekTime ?? 0)
        : null
    const toolConeCarryContinuationVisible = shouldContinueToolConeCarry(
      toolInteractionPhase,
      toolInteractionClipTime,
      Boolean(toolCarryTargetItemId),
    )
    const applyToolConeCarryFollow = () => {
      let followBlend = getToolConeFollowBlend(
        toolInteractionClipTime,
        Boolean(toolCarryTargetItemId),
      )
      const followTargetItemId = toolInteractionTargetItemId ?? toolCarryTargetItemId
      const hasActiveFollowTarget = Boolean(followTargetItemId && followBlend > 1e-4)
      let followTargetCenter = toolConeCarryTargetCenterRef.current
      const leftShoulderBone = leftShoulderFollowBoneRef.current
      const leftUpperArmBone = leftUpperArmBoneRef.current
      const leftElbowBone = leftElbowBoneRef.current

      const applyStoredReleasePose = () => {
        const releaseBlend = MathUtils.clamp(toolConeFollowReleaseBlendRef.current, 0, 1)
        if (!toolConeFollowReleasePoseReadyRef.current || releaseBlend <= 1e-4) {
          toolConeFollowReleaseBlendRef.current = 0
          toolConeFollowReleasePoseReadyRef.current = false
          return
        }

        if (leftShoulderBone) {
          leftShoulderBone.quaternion.slerp(
            toolConeFollowReleaseShoulderQuaternionRef.current,
            releaseBlend,
          )
          leftShoulderBone.updateMatrixWorld(true)
        }
        if (leftUpperArmBone) {
          leftUpperArmBone.quaternion.slerp(
            toolConeFollowReleaseUpperArmQuaternionRef.current,
            releaseBlend,
          )
          leftUpperArmBone.updateMatrixWorld(true)
        }
        if (leftElbowBone) {
          leftElbowBone.quaternion.slerp(
            toolConeFollowReleaseElbowQuaternionRef.current,
            releaseBlend,
          )
          leftElbowBone.updateMatrixWorld(true)
        }
        if (leftHandBone) {
          leftHandBone.quaternion.slerp(
            toolConeFollowReleaseLeftHandQuaternionRef.current,
            releaseBlend,
          )
          leftHandBone.updateMatrixWorld(true)
        }

        const nextReleaseBlend = MathUtils.damp(
          releaseBlend,
          0,
          TOOL_CONE_FOLLOW_RELEASE_RESPONSE,
          frameDelta,
        )
        toolConeFollowReleaseBlendRef.current = nextReleaseBlend
        if (nextReleaseBlend <= 1e-4) {
          toolConeFollowReleaseBlendRef.current = 0
          toolConeFollowReleasePoseReadyRef.current = false
        }
      }

      const captureReleasePose = () => {
        const clampedFollowBlend = MathUtils.clamp(followBlend, 0, 1)
        if (clampedFollowBlend <= 1e-4) {
          return
        }

        toolConeFollowReleaseBlendRef.current = clampedFollowBlend
        toolConeFollowReleasePoseReadyRef.current = true
        if (leftShoulderBone) {
          toolConeFollowReleaseShoulderQuaternionRef.current.copy(leftShoulderBone.quaternion)
        }
        if (leftUpperArmBone) {
          toolConeFollowReleaseUpperArmQuaternionRef.current.copy(leftUpperArmBone.quaternion)
        }
        if (leftElbowBone) {
          toolConeFollowReleaseElbowQuaternionRef.current.copy(leftElbowBone.quaternion)
        }
        if (leftHandBone) {
          toolConeFollowReleaseLeftHandQuaternionRef.current.copy(leftHandBone.quaternion)
        }
      }

      if (hasActiveFollowTarget && followTargetItemId) {
        const targetObject = sceneRegistry.nodes.get(followTargetItemId) ?? null
        if (!targetObject) {
          followBlend = 0
        } else {
          applyLiveTransformToSceneObject(followTargetItemId, targetObject)
          targetObject.updateWorldMatrix(true, true)
          if (
            getObjectWorldCenter(
              targetObject,
              toolConeCarryTargetBoundsRef.current,
              toolConeCarryTargetCenterRef.current,
            )
          ) {
            followTargetCenter = toolConeCarryTargetCenterRef.current
          } else {
            followBlend = 0
          }
        }
      } else {
        applyStoredReleasePose()
        return
      }

      if (followBlend <= 1e-4) {
        applyStoredReleasePose()
        return
      }

      toolConeFollowShoulderTargetRef.current.copy(followTargetCenter).y +=
        TOOL_CONE_FOLLOW_SHOULDER_TARGET_HEIGHT_OFFSET
      toolConeFollowForearmTargetRef.current.copy(followTargetCenter).y +=
        TOOL_CONE_FOLLOW_FOREARM_TARGET_HEIGHT_OFFSET

      aimBoneYAxisTowardWorldTarget(
        leftShoulderBone,
        toolConeFollowShoulderTargetRef.current,
        followBlend * 0.35,
        shoulderAimBoneWorldPositionRef.current,
        shoulderAimTargetDirectionWorldRef.current,
        shoulderAimParentWorldQuaternionRef.current,
        shoulderAimTargetDirectionParentRef.current,
        shoulderAimTargetLocalQuaternionRef.current,
      )
      aimBoneYAxisTowardWorldTarget(
        leftUpperArmBone,
        toolConeFollowShoulderTargetRef.current,
        followBlend * 0.82,
        upperArmAimBoneWorldPositionRef.current,
        upperArmAimTargetDirectionWorldRef.current,
        upperArmAimParentWorldQuaternionRef.current,
        upperArmAimTargetDirectionParentRef.current,
        upperArmAimTargetLocalQuaternionRef.current,
      )
      aimBoneYAxisTowardWorldTarget(
        leftElbowBone,
        toolConeFollowForearmTargetRef.current,
        followBlend,
        forearmAimBoneWorldPositionRef.current,
        forearmAimTargetDirectionWorldRef.current,
        forearmAimParentWorldQuaternionRef.current,
        forearmAimTargetDirectionParentRef.current,
        forearmAimTargetLocalQuaternionRef.current,
      )
      captureReleasePose()
    }
    let toolConeDebugPayload: Record<string, unknown> | null = {
      active: false,
      clipTime: toolInteractionClipTime,
      targetItemId: toolInteractionTargetItemId,
      visible: false,
    }

    if (allAnimationActions.length === 0) {
      visualOffsetGroupRef.current?.position.set(0, 0, 0)
      motionRef.current.rootMotionOffset = [0, 0, 0]
      recordNavigationRobotFramePerf(frameStart)
      return
    }

    if (
      !active &&
      !forcedClipPlayback &&
      !releasedForcedActionRef.current &&
      !revealMaterialsActiveRef.current &&
      !toolRevealMaterialsActiveRef.current
    ) {
      visualOffsetGroupRef.current?.position.set(0, 0, 0)
      motionRef.current.rootMotionOffset = [0, 0, 0]
      recordNavigationRobotFramePerf(frameStart)
      return
    }

    const forcedClipState = motionRef.current.forcedClip
    const visibilityRevealProgress = motionRef.current.visibilityRevealProgress ?? null
    const forcedClipStateMatchesPlayback =
      forcedClipState?.clipName === forcedClipPlayback?.clipName
    const hasActiveForcedClip =
      Boolean(forcedClipPlayback) &&
      Boolean(forcedClipAction) &&
      (forcedClipStateMatchesPlayback || forcedClipPlayback?.clipName === JUMPING_DOWN_CLIP_NAME)
    const activeForcedClipPlayback = hasActiveForcedClip ? forcedClipPlayback : null
    const forcedClipRevealEnabled = Boolean(activeForcedClipPlayback?.revealFromStart)
    let revealProgress = 1
    const targetRevealProgress =
      visibilityRevealProgress !== null
        ? MathUtils.clamp(visibilityRevealProgress, 0, 1)
        : forcedClipState && forcedClipRevealEnabled
          ? MathUtils.clamp(forcedClipState.revealProgress, 0, 1)
          : null
    if (targetRevealProgress !== null || revealMaterialsActiveRef.current) {
      const resolvedRevealProgress = targetRevealProgress ?? 1
      revealProgress = resolvedRevealProgress
      if (visibilityRevealProgress !== null) {
        visualRevealProgressRef.current = resolvedRevealProgress
      } else if (forcedClipState && forcedClipRevealEnabled) {
        const previousVisualRevealProgress = visualRevealProgressRef.current
        revealProgress =
          resolvedRevealProgress < previousVisualRevealProgress
            ? resolvedRevealProgress
            : Math.min(
                resolvedRevealProgress,
                previousVisualRevealProgress +
                  frameDelta / Math.max(FORCED_CLIP_VISUAL_REVEAL_DURATION_SECONDS, 1e-3),
              )
        visualRevealProgressRef.current = revealProgress
      } else {
        visualRevealProgressRef.current = 1
      }
    } else {
      visualRevealProgressRef.current = 1
    }
    const forcedClipSeekTime = forcedClipState?.seekTime ?? null
    const forcedClipPaused = forcedClipState?.paused ?? false
    const effectiveDebugTransitionPreview =
      motionRef.current.debugTransitionPreview ?? debugTransitionPreview ?? null
    const visualOffsetGroup = visualOffsetGroupRef.current
    const revealBoundsGroup = rootGroupRef.current
    if (forcedClipState || visibilityRevealProgress !== null || revealMaterialsActiveRef.current) {
      if (
        revealBoundsGroup &&
        (forcedClipState || visibilityRevealProgress !== null) &&
        (visibilityRevealProgress !== null ||
          forcedClipPaused ||
          forcedClipSeekTime !== null ||
          revealBoundsRef.current.isEmpty())
      ) {
        computeRobotRevealBounds(
          revealBoundsGroup,
          revealBoundsRef.current,
          revealBoundsScratchRef.current,
        )
      }
      let revealMinY = 0
      let revealMaxY = 1
      if (!revealBoundsRef.current.isEmpty()) {
        revealMinY = revealBoundsRef.current.min.y
        revealMaxY = revealBoundsRef.current.max.y
      }
      const revealFeather = Math.max((revealMaxY - revealMinY) * 0.04, 0.02)
      for (const binding of revealMaterialBindingsRef.current) {
        binding.uniforms.revealFeather.value = revealFeather
        binding.uniforms.revealMinY.value = revealMinY
        binding.uniforms.revealMaxY.value = revealMaxY
        binding.uniforms.revealProgress.value = revealProgress
        binding.webgpuUniforms.revealFeather.value = revealFeather
        binding.webgpuUniforms.revealMinY.value = revealMinY
        binding.webgpuUniforms.revealMaxY.value = revealMaxY
        binding.webgpuUniforms.revealProgress.value = revealProgress
      }
      const revealMaterialsShouldBeActive = resolveRevealMaterialsShouldBeActive(
        revealProgress < 1 - 1e-3,
      )
      if (revealMaterialsActiveRef.current !== revealMaterialsShouldBeActive) {
        for (const entry of revealMaterialEntriesRef.current) {
          entry.mesh.material = revealMaterialsShouldBeActive
            ? entry.revealMaterial
            : entry.originalMaterial
        }
        revealMaterialsActiveRef.current = revealMaterialsShouldBeActive
        recordNavigationPerfMark('navigationRobot.revealMaterialModeSwitch', {
          materialDebugMode,
          revealMaterialsActive: revealMaterialsShouldBeActive,
          toolRevealMaterialsActive: toolRevealMaterialsActiveRef.current,
          trigger:
            visibilityRevealProgress !== null
              ? 'visibility-reveal'
              : forcedClipState
                ? 'forced-clip'
                : 'frame',
        })
      }
    }
    let toolRevealProgress = 1
    if (visibilityRevealProgress !== null) {
      toolRevealProgress = revealProgress
      toolVisualRevealProgressRef.current = toolRevealProgress
    } else if (forcedClipState && forcedClipRevealEnabled) {
      if (revealProgress < 1 - 1e-3) {
        toolRevealProgress = 0
        toolVisualRevealProgressRef.current = 0
      } else {
        toolRevealProgress = Math.min(
          1,
          toolVisualRevealProgressRef.current +
            frameDelta / Math.max(TOOL_ATTACHMENT_REVEAL_DURATION_SECONDS, 1e-3),
        )
        toolVisualRevealProgressRef.current = toolRevealProgress
      }
    } else {
      toolRevealProgress = 1
      toolVisualRevealProgressRef.current = 1
    }
    if (toolRevealMaterialBindingsRef.current.length > 0) {
      for (const binding of toolRevealMaterialBindingsRef.current) {
        binding.uniforms.revealProgress.value = toolRevealProgress
        binding.webgpuUniforms.revealProgress.value = toolRevealProgress
      }
      const toolRevealMaterialsShouldBeActive = resolveRevealMaterialsShouldBeActive(
        toolRevealProgress < 1 - 1e-3,
      )
      if (toolRevealMaterialsActiveRef.current !== toolRevealMaterialsShouldBeActive) {
        for (const entry of toolRevealMaterialEntriesRef.current) {
          entry.mesh.material = toolRevealMaterialsShouldBeActive
            ? entry.revealMaterial
            : entry.originalMaterial
        }
        toolRevealMaterialsActiveRef.current = toolRevealMaterialsShouldBeActive
        recordNavigationPerfMark('navigationRobot.toolRevealMaterialModeSwitch', {
          materialDebugMode,
          revealMaterialsActive: revealMaterialsActiveRef.current,
          toolRevealMaterialsActive: toolRevealMaterialsShouldBeActive,
          trigger:
            visibilityRevealProgress !== null
              ? 'visibility-reveal'
              : forcedClipState
                ? 'forced-clip'
                : 'frame',
        })
      }
    }

    if (effectiveDebugTransitionPreview) {
      const previousForcedClipAction = previousForcedClipActionRef.current
      if (previousForcedClipAction) {
        previousForcedClipAction.clampWhenFinished = false
        previousForcedClipAction.paused = false
        previousForcedClipAction.setEffectiveTimeScale(1)
        previousForcedClipAction.stop()
        previousForcedClipActionRef.current = null
      }

      const releasedForcedAction = releasedForcedActionRef.current
      if (releasedForcedAction) {
        releasedForcedAction.clampWhenFinished = false
        releasedForcedAction.paused = false
        releasedForcedAction.setEffectiveTimeScale(1)
        releasedForcedAction.stop()
        releasedForcedActionRef.current = null
      }

      releasedForcedWeightRef.current = 0
    } else if (hasActiveForcedClip && forcedClipAction) {
      previousForcedClipActionRef.current = forcedClipAction
      releasedForcedActionRef.current = null
      releasedForcedWeightRef.current = 0
    } else if (!releasedForcedActionRef.current && previousForcedClipActionRef.current) {
      const previousForcedClipAction = previousForcedClipActionRef.current
      const previousForcedClipName = previousForcedClipAction.getClip().name
      const previousForcedRuntimePlanarRootMotionClip =
        runtimePlanarRootMotionClips.byName.get(previousForcedClipName) ?? null
      if (previousForcedClipName === CHECKOUT_CLIP_NAME) {
        animationBlendStateRef.current = {
          idleWeight: idleAction ? 1 : 0,
          runTimeScale: 1,
          runWeight: 0,
          walkTimeScale: 1,
          walkWeight: 0,
        }
      }
      releasedForcedActionRef.current = previousForcedClipAction
      const releasedForcedClipDuration = releasedForcedActionRef.current.getClip().duration
      const releasedForcedClipHoldTime = getForcedClipHoldTime(
        previousForcedClipName,
        releasedForcedClipDuration,
        previousForcedRuntimePlanarRootMotionClip,
      )
      const releasedForcedClipTime = MathUtils.clamp(
        releasedForcedActionRef.current.time,
        0,
        releasedForcedClipDuration,
      )
      releasedForcedWeightRef.current = 1
      releasedForcedActionRef.current.enabled = true
      releasedForcedActionRef.current.clampWhenFinished = true
      releasedForcedActionRef.current.paused = true
      releasedForcedActionRef.current.play()
      releasedForcedActionRef.current.setEffectiveWeight(1)
      releasedForcedActionRef.current.setEffectiveTimeScale(0)
      // Preserve the exact cut frame when a forced clip ends early, otherwise the release blend
      // snaps to the authored last frame before fading into idle.
      releasedForcedActionRef.current.time = releasedForcedClipTime
      previousForcedClipActionRef.current = null
    }

    if (!effectiveDebugTransitionPreview && activeForcedClipPlayback && forcedClipAction) {
      const stabilizeRootMotion = Boolean(activeForcedClipPlayback.stabilizeRootMotion)
      const forcedClipTimeScale = Math.max(
        0.01,
        forcedClipState?.timeScale ?? activeForcedClipPlayback.timeScale ?? 1,
      )
      const forcedClipDuration = forcedClipAction.getClip().duration
      const forcedClipName = forcedClipAction.getClip().name
      const runtimePlanarRootMotionClip =
        runtimePlanarRootMotionClips.byName.get(activeForcedClipPlayback.clipName) ?? null
      const forcedClipHoldTime = getForcedClipHoldTime(
        forcedClipName,
        forcedClipDuration,
        runtimePlanarRootMotionClip,
      )
      const effectiveForcedClipSeekTime =
        forcedClipSeekTime ?? (revealProgress < 1 - 1e-3 ? 0 : null)
      const sampledForcedClipTime = MathUtils.clamp(
        effectiveForcedClipSeekTime ?? forcedClipAction.time,
        0,
        forcedClipHoldTime,
      )
      const forcedClipAnimationProgress =
        forcedClipDuration > Number.EPSILON
          ? MathUtils.clamp(sampledForcedClipTime / forcedClipDuration, 0, 1)
          : 0
      let rootMotionOffsetX = 0
      let rootMotionOffsetY = 0
      let rootMotionOffsetZ = 0
      if (runtimePlanarRootMotionClip && rootMotionBoneRef.current) {
        const rootMotionParent = rootMotionBoneRef.current.parent ?? rootGroupRef.current
        if (rootMotionParent) {
          const runtimePlanarLocalOffset = runtimePlanarRootMotionClip.samplePlanarLocalOffset(
            sampledForcedClipTime,
            runtimePlanarRootMotionLocalOffsetRef.current,
          )
          rootMotionParent.localToWorld(runtimePlanarRootMotionWorldOriginRef.current.set(0, 0, 0))
          rootMotionParent.localToWorld(
            runtimePlanarRootMotionWorldTargetRef.current.copy(runtimePlanarLocalOffset),
          )
          runtimePlanarRootMotionWorldOffsetRef.current
            .copy(runtimePlanarRootMotionWorldTargetRef.current)
            .sub(runtimePlanarRootMotionWorldOriginRef.current)
          rootMotionOffsetX = runtimePlanarRootMotionWorldOffsetRef.current.x
          rootMotionOffsetZ = runtimePlanarRootMotionWorldOffsetRef.current.z

          if (visualOffsetGroup?.parent) {
            runtimePlanarRootMotionVisualOriginRef.current.copy(
              runtimePlanarRootMotionWorldOriginRef.current,
            )
            runtimePlanarRootMotionVisualTargetRef.current.copy(
              runtimePlanarRootMotionWorldTargetRef.current,
            )
            visualOffsetGroup.parent.worldToLocal(runtimePlanarRootMotionVisualOriginRef.current)
            visualOffsetGroup.parent.worldToLocal(runtimePlanarRootMotionVisualTargetRef.current)
            runtimePlanarRootMotionVisualOffsetRef.current
              .copy(runtimePlanarRootMotionVisualTargetRef.current)
              .sub(runtimePlanarRootMotionVisualOriginRef.current)
          } else {
            runtimePlanarRootMotionVisualOffsetRef.current.copy(
              runtimePlanarRootMotionWorldOffsetRef.current,
            )
          }
        } else {
          runtimePlanarRootMotionVisualOffsetRef.current.set(0, 0, 0)
        }
      } else if (
        rootGroupRef.current &&
        rootMotionBoneRef.current &&
        rootMotionBaselineScenePositionRef.current
      ) {
        getCurrentRootMotionOffset(
          rootGroupRef.current,
          rootMotionBoneRef.current,
          rootMotionBaselineScenePositionRef.current,
          rootMotionBaselineWorldRef.current,
          rootMotionCurrentWorldRef.current,
          rootMotionOffsetRef.current,
        )
        rootMotionOffsetX = rootMotionOffsetRef.current.x
        rootMotionOffsetY = rootMotionOffsetRef.current.y
        rootMotionOffsetZ = rootMotionOffsetRef.current.z
      }
      if (visualOffsetGroup) {
        let visualOffsetX = 0
        let visualOffsetY = 0
        let visualOffsetZ = 0
        if (runtimePlanarRootMotionClip) {
          visualOffsetX += runtimePlanarRootMotionVisualOffsetRef.current.x
          visualOffsetY += runtimePlanarRootMotionVisualOffsetRef.current.y
          visualOffsetZ += runtimePlanarRootMotionVisualOffsetRef.current.z
        }
        if (forcedClipVisualOffset) {
          const visualOffsetWeight =
            forcedClipPaused || effectiveForcedClipSeekTime !== null
              ? 1
              : 1 - MathUtils.smoothstep(forcedClipAnimationProgress, 0, 0.22)
          visualOffsetX += forcedClipVisualOffset[0] * visualOffsetWeight
          visualOffsetY += forcedClipVisualOffset[1] * visualOffsetWeight
          visualOffsetZ += forcedClipVisualOffset[2] * visualOffsetWeight
        }
        if (stabilizeRootMotion && !runtimePlanarRootMotionClip) {
          visualOffsetX -= rootMotionOffsetX
          visualOffsetZ -= rootMotionOffsetZ
        }
        visualOffsetGroup.position.set(visualOffsetX, visualOffsetY, visualOffsetZ)
        if (effectiveForcedClipSeekTime !== null) {
          forcedClipAction.time = MathUtils.clamp(
            effectiveForcedClipSeekTime,
            0,
            forcedClipHoldTime,
          )
        }
      } else {
        if (effectiveForcedClipSeekTime !== null) {
          forcedClipAction.time = MathUtils.clamp(
            effectiveForcedClipSeekTime,
            0,
            forcedClipHoldTime,
          )
        }
      }
      const shouldHoldLastForcedFrame =
        activeForcedClipPlayback.loop === 'once' &&
        Boolean(activeForcedClipPlayback.holdLastFrame) &&
        effectiveForcedClipSeekTime === null &&
        forcedClipAction.time >= forcedClipHoldTime - 1e-3
      if (shouldHoldLastForcedFrame) {
        forcedClipAction.time = forcedClipHoldTime
      }
      const forcedClipShouldPause =
        forcedClipPaused || effectiveForcedClipSeekTime !== null || shouldHoldLastForcedFrame
      const forcedClipFinished =
        activeForcedClipPlayback.loop === 'once' &&
        forcedClipAction.time >= forcedClipHoldTime - 1e-3
      const keepLocomotionWarmDuringForcedClip = forcedClipName === CHECKOUT_CLIP_NAME

      for (const action of runtimeActions) {
        const isForcedAction = action === forcedClipAction
        if (!isForcedAction) {
          if (!keepLocomotionWarmDuringForcedClip) {
            setActionInactive(action)
            continue
          }
          const standbyTimeScale =
            action === idleAction
              ? IDLE_TIME_SCALE
              : action === walkAction
                ? Math.max(0.01, motionRef.current.locomotion.walkTimeScale)
                : action === runAction
                  ? Math.max(0.01, motionRef.current.locomotion.runTimeScale)
                  : 1
          setActionActive(action, 0, standbyTimeScale)
          continue
        }

        action.enabled = true
        action.paused = forcedClipShouldPause
        if (!action.isRunning()) {
          action.play()
        }
        action.setEffectiveWeight(1)
        action.setEffectiveTimeScale(forcedClipFinished ? 0 : forcedClipTimeScale)
      }

      const landingShoulderBlendWeight =
        forcedClipName === JUMPING_DOWN_CLIP_NAME
          ? getLandingShoulderBlendWeight(runtimePlanarRootMotionClip, sampledForcedClipTime)
          : 0
      motionRef.current.rootMotionOffset = stabilizeRootMotion
        ? [0, 0, 0]
        : [rootMotionOffsetX, rootMotionOffsetY, rootMotionOffsetZ]
      motionRef.current.debugActiveClipName = forcedClipName
      motionRef.current.debugForcedClipRevealProgress = revealProgress
      motionRef.current.debugForcedClipTime = sampledForcedClipTime
      motionRef.current.debugLandingShoulderBlendWeight = landingShoulderBlendWeight
      motionRef.current.debugReleasedForcedClipName = null
      motionRef.current.debugReleasedForcedClipTime = null
      motionRef.current.debugReleasedForcedWeight = 0

      if (forcedClipName !== activeClipNameRef.current) {
        activeClipNameRef.current = forcedClipName
        mergeNavigationPerfMeta({
          navigationRobotActiveClip: forcedClipName,
        })
      }

      applyShoulderPoseTargets(
        shoulderBonesRef.current,
        idleShoulderTargets,
        landingShoulderBlendWeight,
      )
      if (forcedClipName === CHECKOUT_CLIP_NAME) {
        const checkoutBlend = MathUtils.smootherstep(
          1 - Math.abs(forcedClipAnimationProgress * 2 - 1),
          0,
          1,
        )
        if (checkoutBlend > 1e-3 && leftHandBoneRef.current) {
          checkoutLeftHandBaseQuaternionRef.current.copy(leftHandBoneRef.current.quaternion)
          checkoutLeftHandScratchRef.current
            .identity()
            .slerp(checkoutLeftHandRotationRef.current, checkoutBlend)
          leftHandBoneRef.current.quaternion.premultiply(checkoutLeftHandScratchRef.current)
          leftHandBoneRef.current.updateMatrixWorld(true)
          checkoutLeftHandRestorePendingRef.current = true
        }
      }
      measureNavigationPerf('navigationRobot.toolConeCarryFollowMs', () => {
        applyToolConeCarryFollow()
      })
      toolConeDebugPayload = measureNavigationPerf('navigationRobot.toolConeOverlayMs', () =>
        updateToolConeOverlay(
          camera,
          toolInteractionTargetItemId,
          toolInteractionPhase,
          toolInteractionClipTime,
          toolConeCarryContinuationVisible,
          toolConeCarryContinuationVisible,
          Boolean(toolCarryTargetItemId),
          shouldCaptureRobotDebugState,
        ),
      )

      if (shouldCaptureRobotDebugState && typeof window !== 'undefined') {
        writeRobotDebugState(debugId, debugStateRef, {
          activeClipName: activeClipNameRef.current,
          forcedClipName,
          forcedClipPlaying: true,
          forcedClipRevealProgress: revealProgress,
          forcedClipTime: sampledForcedClipTime,
          landingShoulderBlendWeight,
          locomotion: {
            moveBlend: motionRef.current.locomotion.moveBlend,
            runBlend: motionRef.current.locomotion.runBlend,
            runTimeScale: motionRef.current.locomotion.runTimeScale,
            walkTimeScale: motionRef.current.locomotion.walkTimeScale,
          },
          materialDebugMode,
          revealMaterialsActive: revealMaterialsActiveRef.current,
          toolRevealMaterialsActive: toolRevealMaterialsActiveRef.current,
          materialWarmupReady,
          moving: motionRef.current.moving,
          releasedForcedClipName: null,
          releasedForcedClipTime: null,
          releasedForcedWeight: 0,
          rootMotionOffset: motionRef.current.rootMotionOffset,
          toolCone: toolConeDebugPayload,
        })
      }

      recordNavigationRobotFramePerf(frameStart)
      return
    }

    if (effectiveDebugTransitionPreview) {
      motionRef.current.rootMotionOffset = [0, 0, 0]
      const locomotion = motionRef.current.locomotion
      const animationBlendState = animationBlendStateRef.current
      const previewReleasedAction =
        actions[effectiveDebugTransitionPreview.releasedClipName] ?? null
      const previewReleasedClipTime = previewReleasedAction
        ? MathUtils.clamp(
            effectiveDebugTransitionPreview.releasedClipTime,
            0,
            previewReleasedAction.getClip().duration,
          )
        : 0
      const previewReleasedWeight = MathUtils.clamp(
        effectiveDebugTransitionPreview.releasedClipWeight,
        0,
        1,
      )
      const previewReleasedRuntimePlanarRootMotionClip = previewReleasedAction
        ? (runtimePlanarRootMotionClips.byName.get(previewReleasedAction.getClip().name) ?? null)
        : null

      if (previewReleasedAction) {
        previewReleasedAction.enabled = true
        previewReleasedAction.clampWhenFinished = true
        previewReleasedAction.paused = true
        if (!previewReleasedAction.isRunning()) {
          previewReleasedAction.play()
        }
        previewReleasedAction.setEffectiveWeight(1)
        previewReleasedAction.setEffectiveTimeScale(0)
        previewReleasedAction.time = previewReleasedClipTime
      }

      if (visualOffsetGroup) {
        if (
          previewReleasedAction &&
          rootGroupRef.current &&
          rootMotionBoneRef.current &&
          rootMotionBaselineScenePositionRef.current
        ) {
          getCurrentRootMotionOffset(
            rootGroupRef.current,
            rootMotionBoneRef.current,
            rootMotionBaselineScenePositionRef.current,
            rootMotionBaselineWorldRef.current,
            rootMotionCurrentWorldRef.current,
            rootMotionOffsetRef.current,
          )
          const previewReleaseOffsetWeight = MathUtils.clamp(previewReleasedWeight, 0, 1)
          visualOffsetGroup.position.set(
            -rootMotionOffsetRef.current.x * previewReleaseOffsetWeight,
            0,
            -rootMotionOffsetRef.current.z * previewReleaseOffsetWeight,
          )
        } else {
          visualOffsetGroup.position.set(0, 0, 0)
        }
      }

      const moveBlendTarget = motionRef.current.moving
        ? MathUtils.clamp(locomotion.moveBlend, 0, 1)
        : 0
      const runBlendTarget = Math.min(moveBlendTarget, MathUtils.clamp(locomotion.runBlend, 0, 1))
      const walkBlendTarget = Math.max(0, moveBlendTarget - runBlendTarget)
      const idleBlendTarget = Math.max(0, 1 - moveBlendTarget)
      animationBlendState.idleWeight = idleBlendTarget
      animationBlendState.walkWeight = walkBlendTarget
      animationBlendState.runWeight = runBlendTarget
      animationBlendState.walkTimeScale = Math.max(0.01, locomotion.walkTimeScale)
      animationBlendState.runTimeScale = Math.max(0.01, locomotion.runTimeScale)

      if (
        walkAction &&
        runAction &&
        walkAction !== runAction &&
        (animationBlendState.walkWeight > 1e-3 || animationBlendState.runWeight > 1e-3)
      ) {
        const sourceAction =
          animationBlendState.runWeight > animationBlendState.walkWeight ? runAction : walkAction
        const targetAction = sourceAction === runAction ? walkAction : runAction
        syncActionPhase(sourceAction, targetAction)
      }

      const actionTargets = new Map<
        AnimationAction,
        { timeScaleSum: number; weight: number; weightedTimeScale: number }
      >()
      const locomotionBlendWeight = 1 - previewReleasedWeight
      accumulateActionTarget(
        actionTargets,
        idleAction,
        animationBlendState.idleWeight * locomotionBlendWeight,
        IDLE_TIME_SCALE,
      )
      accumulateActionTarget(
        actionTargets,
        walkAction,
        animationBlendState.walkWeight * locomotionBlendWeight,
        animationBlendState.walkTimeScale,
      )
      accumulateActionTarget(
        actionTargets,
        runAction,
        animationBlendState.runWeight * locomotionBlendWeight,
        animationBlendState.runTimeScale,
      )
      accumulateActionTarget(actionTargets, previewReleasedAction, previewReleasedWeight, 0)

      const blendedRuntimeActions = getUniqueActions([...runtimeActions, previewReleasedAction])
      for (const action of blendedRuntimeActions) {
        const target = actionTargets.get(action)
        const targetWeight = MathUtils.clamp(target?.weight ?? 0, 0, 1)

        if (targetWeight <= 1e-3) {
          setActionInactive(action)
          continue
        }

        setActionActive(
          action,
          targetWeight,
          target && target.weightedTimeScale > Number.EPSILON
            ? target.timeScaleSum / target.weightedTimeScale
            : 1,
        )
      }

      const landingShoulderBlendWeight =
        previewReleasedAction?.getClip().name === JUMPING_DOWN_CLIP_NAME
          ? getLandingShoulderBlendWeight(
              previewReleasedRuntimePlanarRootMotionClip,
              previewReleasedClipTime,
            )
          : 0
      applyShoulderPoseTargets(
        shoulderBonesRef.current,
        idleShoulderTargets,
        previewReleasedAction ? Math.max(1 - previewReleasedWeight, landingShoulderBlendWeight) : 0,
      )
      measureNavigationPerf('navigationRobot.toolConeCarryFollowMs', () => {
        applyToolConeCarryFollow()
      })
      toolConeDebugPayload = measureNavigationPerf('navigationRobot.toolConeOverlayMs', () =>
        updateToolConeOverlay(
          camera,
          toolInteractionTargetItemId,
          toolInteractionPhase,
          toolInteractionClipTime,
          toolConeCarryContinuationVisible,
          toolConeCarryContinuationVisible,
          Boolean(toolCarryTargetItemId),
          shouldCaptureRobotDebugState,
        ),
      )
      motionRef.current.debugActiveClipName = activeClipNameRef.current
      motionRef.current.debugForcedClipRevealProgress = 1
      motionRef.current.debugForcedClipTime = null
      motionRef.current.debugLandingShoulderBlendWeight = landingShoulderBlendWeight
      motionRef.current.debugReleasedForcedClipName = previewReleasedAction?.getClip().name ?? null
      motionRef.current.debugReleasedForcedClipTime = previewReleasedAction
        ? previewReleasedClipTime
        : null
      motionRef.current.debugReleasedForcedWeight = previewReleasedWeight

      const dominantAction =
        animationBlendState.runWeight >= animationBlendState.walkWeight &&
        animationBlendState.runWeight >= animationBlendState.idleWeight
          ? runAction
          : animationBlendState.walkWeight >= animationBlendState.idleWeight
            ? walkAction
            : idleAction
      const dominantClipName = dominantAction?.getClip().name ?? null
      if (dominantClipName !== activeClipNameRef.current) {
        activeClipNameRef.current = dominantClipName
        mergeNavigationPerfMeta({
          navigationRobotActiveClip: dominantClipName,
        })
      }
      motionRef.current.debugActiveClipName = activeClipNameRef.current

      if (shouldCaptureRobotDebugState && typeof window !== 'undefined') {
        writeRobotDebugState(debugId, debugStateRef, {
          activeClipName: activeClipNameRef.current,
          forcedClipName: null,
          forcedClipPlaying: false,
          forcedClipRevealProgress: 1,
          forcedClipTime: null,
          landingShoulderBlendWeight,
          locomotion: {
            moveBlend: motionRef.current.locomotion.moveBlend,
            runBlend: motionRef.current.locomotion.runBlend,
            runTimeScale: motionRef.current.locomotion.runTimeScale,
            walkTimeScale: motionRef.current.locomotion.walkTimeScale,
          },
          materialDebugMode,
          revealMaterialsActive: revealMaterialsActiveRef.current,
          toolRevealMaterialsActive: toolRevealMaterialsActiveRef.current,
          materialWarmupReady,
          moving: motionRef.current.moving,
          releasedForcedClipName: previewReleasedAction?.getClip().name ?? null,
          releasedForcedClipTime: previewReleasedAction ? previewReleasedClipTime : null,
          releasedForcedWeight: previewReleasedWeight,
          rootMotionOffset: motionRef.current.rootMotionOffset,
          toolCone: toolConeDebugPayload,
        })
      }

      recordNavigationRobotFramePerf(frameStart)
      return
    }

    motionRef.current.rootMotionOffset = [0, 0, 0]
    const locomotion = motionRef.current.locomotion
    const animationBlendState = animationBlendStateRef.current
    const releasedForcedAction = releasedForcedActionRef.current
    const releasedForcedRuntimePlanarRootMotionClip = releasedForcedAction
      ? (runtimePlanarRootMotionClips.byName.get(releasedForcedAction.getClip().name) ?? null)
      : null
    const releasedForcedBlendResponse = releasedForcedAction
      ? (SLOW_RELEASE_CLIP_BLEND_RESPONSE_BY_NAME[releasedForcedAction.getClip().name] ??
        FORCED_CLIP_RELEASE_BLEND_RESPONSE)
      : FORCED_CLIP_RELEASE_BLEND_RESPONSE
    const releasedForcedWeight = releasedForcedAction
      ? MathUtils.damp(releasedForcedWeightRef.current, 0, releasedForcedBlendResponse, frameDelta)
      : 0
    releasedForcedWeightRef.current = releasedForcedWeight
    if (releasedForcedAction && releasedForcedWeight <= 1e-3) {
      releasedForcedAction.clampWhenFinished = false
      releasedForcedAction.paused = false
      releasedForcedAction.setEffectiveTimeScale(1)
      releasedForcedAction.stop()
      releasedForcedActionRef.current = null
      releasedForcedWeightRef.current = 0
    }
    if (visualOffsetGroup) {
      if (
        releasedForcedAction &&
        rootGroupRef.current &&
        rootMotionBoneRef.current &&
        rootMotionBaselineScenePositionRef.current
      ) {
        getCurrentRootMotionOffset(
          rootGroupRef.current,
          rootMotionBoneRef.current,
          rootMotionBaselineScenePositionRef.current,
          rootMotionBaselineWorldRef.current,
          rootMotionCurrentWorldRef.current,
          rootMotionOffsetRef.current,
        )
        const releaseOffsetWeight = MathUtils.clamp(releasedForcedWeight, 0, 1)
        visualOffsetGroup.position.set(
          -rootMotionOffsetRef.current.x * releaseOffsetWeight,
          0,
          -rootMotionOffsetRef.current.z * releaseOffsetWeight,
        )
      } else {
        visualOffsetGroup.position.set(0, 0, 0)
      }
    }
    const moveBlendTarget = motionRef.current.moving
      ? MathUtils.clamp(locomotion.moveBlend, 0, 1)
      : 0
    const runBlendTarget = Math.min(moveBlendTarget, MathUtils.clamp(locomotion.runBlend, 0, 1))
    const walkBlendTarget = Math.max(0, moveBlendTarget - runBlendTarget)
    const idleBlendTarget = Math.max(0, 1 - moveBlendTarget)

    animationBlendState.idleWeight = MathUtils.damp(
      animationBlendState.idleWeight,
      idleBlendTarget,
      CLIP_BLEND_RESPONSE,
      frameDelta,
    )
    animationBlendState.walkWeight = MathUtils.damp(
      animationBlendState.walkWeight,
      walkBlendTarget,
      CLIP_BLEND_RESPONSE,
      frameDelta,
    )
    animationBlendState.runWeight = MathUtils.damp(
      animationBlendState.runWeight,
      runBlendTarget,
      CLIP_BLEND_RESPONSE,
      frameDelta,
    )
    animationBlendState.walkTimeScale = MathUtils.damp(
      animationBlendState.walkTimeScale,
      Math.max(0.01, locomotion.walkTimeScale),
      CLIP_TIME_SCALE_RESPONSE,
      frameDelta,
    )
    animationBlendState.runTimeScale = MathUtils.damp(
      animationBlendState.runTimeScale,
      Math.max(0.01, locomotion.runTimeScale),
      CLIP_TIME_SCALE_RESPONSE,
      frameDelta,
    )

    if (
      walkAction &&
      runAction &&
      walkAction !== runAction &&
      (animationBlendState.walkWeight > 1e-3 || animationBlendState.runWeight > 1e-3)
    ) {
      const sourceAction =
        animationBlendState.runWeight > animationBlendState.walkWeight ? runAction : walkAction
      const targetAction = sourceAction === runAction ? walkAction : runAction
      syncActionPhase(sourceAction, targetAction)
    }

    const actionTargets = new Map<
      AnimationAction,
      { timeScaleSum: number; weight: number; weightedTimeScale: number }
    >()
    const releaseToIdleOnly =
      releasedForcedAction?.getClip().name === CHECKOUT_CLIP_NAME && !motionRef.current.moving
    const locomotionBlendWeight = 1 - MathUtils.clamp(releasedForcedWeight, 0, 1)
    accumulateActionTarget(
      actionTargets,
      idleAction,
      (releaseToIdleOnly ? 1 : animationBlendState.idleWeight) * locomotionBlendWeight,
      IDLE_TIME_SCALE,
    )
    if (!releaseToIdleOnly) {
      accumulateActionTarget(
        actionTargets,
        walkAction,
        animationBlendState.walkWeight * locomotionBlendWeight,
        animationBlendState.walkTimeScale,
      )
      accumulateActionTarget(
        actionTargets,
        runAction,
        animationBlendState.runWeight * locomotionBlendWeight,
        animationBlendState.runTimeScale,
      )
    }
    accumulateActionTarget(
      actionTargets,
      releasedForcedActionRef.current,
      MathUtils.clamp(releasedForcedWeight, 0, 1),
      0,
    )

    const blendedRuntimeActions = getUniqueActions([
      ...runtimeActions,
      releasedForcedActionRef.current,
    ])

    for (const action of blendedRuntimeActions) {
      const target = actionTargets.get(action)
      const targetWeight = MathUtils.clamp(target?.weight ?? 0, 0, 1)

      if (targetWeight <= 1e-3) {
        setActionInactive(action)
        continue
      }

      setActionActive(
        action,
        targetWeight,
        target && target.weightedTimeScale > Number.EPSILON
          ? target.timeScaleSum / target.weightedTimeScale
          : 1,
      )
    }

    const releaseLandingShoulderBlendWeight = releasedForcedAction
      ? Math.max(
          1 - MathUtils.clamp(releasedForcedWeight, 0, 1),
          getLandingShoulderBlendWeight(
            releasedForcedRuntimePlanarRootMotionClip,
            releasedForcedAction.time,
          ),
        )
      : 0
    applyShoulderPoseTargets(
      shoulderBonesRef.current,
      idleShoulderTargets,
      releaseLandingShoulderBlendWeight,
    )
    measureNavigationPerf('navigationRobot.toolConeCarryFollowMs', () => {
      applyToolConeCarryFollow()
    })
    toolConeDebugPayload = measureNavigationPerf('navigationRobot.toolConeOverlayMs', () =>
      updateToolConeOverlay(
        camera,
        toolInteractionTargetItemId,
        toolInteractionPhase,
        toolInteractionClipTime,
        toolConeCarryContinuationVisible,
        toolConeCarryContinuationVisible,
        Boolean(toolCarryTargetItemId),
        shouldCaptureRobotDebugState,
      ),
    )

    const dominantAction =
      animationBlendState.runWeight >= animationBlendState.walkWeight &&
      animationBlendState.runWeight >= animationBlendState.idleWeight
        ? runAction
        : animationBlendState.walkWeight >= animationBlendState.idleWeight
          ? walkAction
          : idleAction
    const dominantClipName = dominantAction?.getClip().name ?? null

    if (dominantClipName !== activeClipNameRef.current) {
      activeClipNameRef.current = dominantClipName
      mergeNavigationPerfMeta({
        navigationRobotActiveClip: dominantClipName,
      })
    }
    motionRef.current.debugActiveClipName = activeClipNameRef.current
    motionRef.current.debugForcedClipRevealProgress = 1
    motionRef.current.debugForcedClipTime = null
    motionRef.current.debugLandingShoulderBlendWeight = releaseLandingShoulderBlendWeight
    motionRef.current.debugReleasedForcedClipName = releasedForcedAction?.getClip().name ?? null
    motionRef.current.debugReleasedForcedClipTime = releasedForcedAction?.time ?? null
    motionRef.current.debugReleasedForcedWeight = releasedForcedWeight

    let changedBoneCount = 0
    let maxBoneAngleDelta = 0
    let maxBonePositionDelta = 0

    if (NAVIGATION_ROBOT_DEBUG_ENABLED) {
      const debugBoneSamples = debugBoneSamplesRef.current
      for (const sample of debugBoneSamples) {
        const positionDelta = sample.bone.position.distanceTo(sample.previousPosition)
        const angleDelta = sample.bone.quaternion.angleTo(sample.previousQuaternion)
        if (positionDelta > 1e-5 || angleDelta > 1e-5) {
          changedBoneCount += 1
        }
        maxBonePositionDelta = Math.max(maxBonePositionDelta, positionDelta)
        maxBoneAngleDelta = Math.max(maxBoneAngleDelta, angleDelta)
        sample.previousPosition.copy(sample.bone.position)
        sample.previousQuaternion.copy(sample.bone.quaternion)
      }

      if (
        motionRef.current.moving &&
        (changedBoneCount > 0 || maxBoneAngleDelta > 1e-5 || maxBonePositionDelta > 1e-5)
      ) {
        debugMovingEvidenceRef.current += 1
      }
    }

    if (shouldCaptureRobotDebugState && typeof window !== 'undefined') {
      writeRobotDebugState(debugId, debugStateRef, {
        activeClipName: activeClipNameRef.current,
        changedBoneCount,
        forcedClipName: null,
        forcedClipPlaying: false,
        forcedClipRevealProgress: 1,
        forcedClipTime: null,
        landingShoulderBlendWeight: releaseLandingShoulderBlendWeight,
        locomotion: {
          moveBlend: locomotion.moveBlend,
          runBlend: locomotion.runBlend,
          runTimeScale: locomotion.runTimeScale,
          walkTimeScale: locomotion.walkTimeScale,
        },
        materialDebugMode,
        revealMaterialsActive: revealMaterialsActiveRef.current,
        toolRevealMaterialsActive: toolRevealMaterialsActiveRef.current,
        materialWarmupReady,
        maxBoneAngleDelta,
        maxBonePositionDelta,
        moving: motionRef.current.moving,
        movingEvidenceFrames: debugMovingEvidenceRef.current,
        releasedForcedClipName: releasedForcedAction?.getClip().name ?? null,
        releasedForcedClipTime: releasedForcedAction?.time ?? null,
        releasedForcedWeight,
        rootMotionOffset: motionRef.current.rootMotionOffset,
        toolCone: toolConeDebugPayload,
        weights: {
          idle: animationBlendState.idleWeight,
          run: animationBlendState.runWeight,
          walk: animationBlendState.walkWeight,
        },
      })
    }

    recordNavigationRobotFramePerf(frameStart)
  })

  return (
    <group ref={visualOffsetGroupRef}>
      <group
        ref={rootGroupRef}
        position={robotTransform.offset}
        rotation={[0, MODEL_FORWARD_ROTATION_Y, 0]}
        scale={robotTransform.scale}
      >
        <primitive object={clonedScene} />
      </group>
    </group>
  )
}

useGLTF.preload(TOOL_ASSET_PATH)

useGLTF.preload(NAVIGATION_ROBOT_ASSET_PATH)
