import {
  type AlignmentAnchor,
  type AnyNodeId,
  type MeasurementFeatureAnchor,
  type MeasurementSnapKind,
  measurementDistance,
  measurementFeatureLength,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import type { MeasurementAxis, MeasurementAxisGuide, MeasurementPoint } from '@pascal-app/editor'
import { SCENE_LAYER, ZONE_LAYER } from '@pascal-app/viewer'
import {
  type Camera,
  type InstancedMesh,
  type Intersection,
  type Material,
  Matrix3,
  Matrix4,
  type Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { matchMeasurementFeatureForNode } from './resolve'

const AXIS_SNAP_DISTANCE_PX = 16
const AXIS_SNAP_RELEASE_DISTANCE_PX = 24
const PROXIMITY_GUIDE_DISTANCE_PX = 40
const VERTEX_HANDLE_DISTANCE_PX = 12
const SURFACE_VERIFY_HALF_SPAN = 0.08
const SURFACE_VERIFY_TOLERANCE = 0.012
const SEMANTIC_FEATURE_SNAP_DISTANCE = 0.2
const AXIS_INTERSECTION_MIN_DISTANCE = 0.05
const MAX_AXIS_INTERSECTIONS_PER_DIRECTION = 4
const UNREGISTERED_ROOT_REFRESH_MS = 500
const ZONE_SURFACE_PRIORITY_DISTANCE = 0.08
const SURFACE_INTENT_MAX_OCCLUSION_DISTANCE = 0.45
const SURFACE_INTENT_MIN_NORMAL_ALIGNMENT = 0.94
const SURFACE_INTENT_PLANE_TOLERANCE = 0.05
const HORIZONTAL_SURFACE_MIN_NORMAL_Y = 0.85
const HORIZONTAL_SURFACE_MAX_OCCLUDER_NORMAL_Y = 0.5
const HORIZONTAL_SURFACE_TYPES = new Set(['slab', 'ceiling', 'site'])

export type MeasurementRaycastContext = {
  ownerByObject: Map<Object3D, string>
  roots: Object3D[]
  includeZoneLayer?: boolean
}

export type WorldSurfaceHit = {
  intersection: Intersection<Object3D>
  targetNodeId: string | null
}

export type LocalSurfaceHit = {
  point: MeasurementPoint
  normal: MeasurementPoint
  targetNodeId: string | null
}

export type MeasurementSurfacePreference =
  | { kind: 'horizontal' }
  | { kind: 'plane'; point: MeasurementPoint; normal: MeasurementPoint }

export type MeasurementAxisProjection = {
  axis: MeasurementAxis
  point: MeasurementPoint
}

export type MeasurementAxisSurfaceIntersection = {
  axis: MeasurementAxis
  normal: MeasurementPoint
  point: MeasurementPoint
}

export type MeasurementAxisCandidate = MeasurementAxisProjection & {
  anchor?: MeasurementPoint
  proximity?: boolean
  screenDistance: number
  verified: boolean
}

export type MeasurementSurfaceQuerySession = {
  resolvePointer(args: {
    event: MouseEvent | PointerEvent
    camera: Camera
    canvas: HTMLCanvasElement
    levelObject: Object3D
    anchorOrAnchors: MeasurementPoint | readonly MeasurementPoint[] | null
    lockedGuide?: MeasurementAxisGuide | null
    planarProximityAnchors?: readonly AlignmentAnchor[]
    surfacePreference?: MeasurementSurfacePreference | null
    applyMagneticSnap: boolean
    showAlignmentGuides: boolean
  }): { hit: LocalSurfaceHit; guide: MeasurementAxisGuide | null } | null
  collectAxisIntersections(args: {
    levelObject: Object3D
    anchor: MeasurementPoint
    maxDistance?: number
  }): MeasurementAxisSurfaceIntersection[]
  invalidate(): void
  dispose(): void
}

function areSameMeasurementPoint(
  first: MeasurementPoint | undefined,
  second: MeasurementPoint | null,
): boolean {
  return Boolean(
    first &&
      second &&
      Math.abs(first[0] - second[0]) <= 1e-9 &&
      Math.abs(first[1] - second[1]) <= 1e-9 &&
      Math.abs(first[2] - second[2]) <= 1e-9,
  )
}

function selectClosestAxisCandidate<T extends MeasurementAxisCandidate>(
  candidates: readonly T[],
  threshold: number,
  lockedAxis: MeasurementAxis | null,
  releaseThreshold: number,
  lockedFrom: MeasurementPoint | null = null,
): T | null {
  if (lockedAxis) {
    const locked = candidates.reduce<T | null>((closest, candidate) => {
      if (
        candidate.axis !== lockedAxis ||
        (lockedFrom && !areSameMeasurementPoint(candidate.anchor, lockedFrom)) ||
        !candidate.verified ||
        candidate.screenDistance > releaseThreshold
      ) {
        return closest
      }
      return !closest || candidate.screenDistance < closest.screenDistance ? candidate : closest
    }, null)
    if (locked) return locked
  }

  return candidates.reduce<T | null>((closest, candidate) => {
    if (!candidate.verified || candidate.screenDistance > threshold) return closest
    return !closest || candidate.screenDistance < closest.screenDistance ? candidate : closest
  }, null)
}

export function projectMeasurementPointToAxes(
  anchor: MeasurementPoint,
  point: MeasurementPoint,
): MeasurementAxisProjection[] {
  return [
    { axis: 'x', point: [point[0], anchor[1], anchor[2]] },
    { axis: 'y', point: [anchor[0], point[1], anchor[2]] },
    { axis: 'z', point: [anchor[0], anchor[1], point[2]] },
  ]
}

export function projectMeasurementPointToPlanarAxes(
  anchor: MeasurementPoint,
  point: MeasurementPoint,
): MeasurementAxisProjection[] {
  return projectMeasurementPointToAxes(anchor, point).filter(
    (candidate) => candidate.axis === 'x' || candidate.axis === 'z',
  )
}

export function selectClosestVerifiedAxisProjection(
  candidates: readonly MeasurementAxisCandidate[],
  threshold = AXIS_SNAP_DISTANCE_PX,
  lockedAxis: MeasurementAxis | null = null,
  releaseThreshold = AXIS_SNAP_RELEASE_DISTANCE_PX,
  lockedFrom: MeasurementPoint | null = null,
): MeasurementAxisProjection | null {
  const closest = selectClosestAxisCandidate(
    candidates,
    threshold,
    lockedAxis,
    releaseThreshold,
    lockedFrom,
  )
  return closest ? { axis: closest.axis, point: [...closest.point] } : null
}

export function selectAxisCandidateForSurfaceVerification<T extends MeasurementAxisCandidate>(
  candidates: readonly T[],
  threshold = AXIS_SNAP_DISTANCE_PX,
  lockedAxis: MeasurementAxis | null = null,
  releaseThreshold = AXIS_SNAP_RELEASE_DISTANCE_PX,
  lockedFrom: MeasurementPoint | null = null,
): T | null {
  if (lockedAxis) {
    const locked = candidates.reduce<T | null>((closest, candidate) => {
      if (
        candidate.axis !== lockedAxis ||
        (lockedFrom && !areSameMeasurementPoint(candidate.anchor, lockedFrom)) ||
        candidate.screenDistance > releaseThreshold
      ) {
        return closest
      }
      return !closest || candidate.screenDistance < closest.screenDistance ? candidate : closest
    }, null)
    if (locked) return locked
  }

  return candidates.reduce<T | null>((closest, candidate) => {
    if (candidate.screenDistance > threshold) return closest
    return !closest || candidate.screenDistance < closest.screenDistance ? candidate : closest
  }, null)
}

export function measurementVertexSnapAnchors(
  points: readonly MeasurementPoint[],
  index: number,
  polygon: boolean,
): MeasurementPoint[] {
  if (!Number.isInteger(index) || index < 0 || index >= points.length || points.length < 2) {
    return []
  }
  const neighborIndices =
    polygon && points.length >= 3
      ? [(index - 1 + points.length) % points.length, (index + 1) % points.length]
      : [index - 1, index + 1]
  return Array.from(new Set(neighborIndices))
    .filter(
      (neighborIndex) =>
        neighborIndex >= 0 && neighborIndex < points.length && neighborIndex !== index,
    )
    .map((neighborIndex) => [...points[neighborIndex]!] as MeasurementPoint)
}

export function selectClosestMeasurementVertexIndex(
  screenDistances: readonly number[],
  threshold = VERTEX_HANDLE_DISTANCE_PX,
): number | null {
  let closestIndex: number | null = null
  let closestDistance = threshold
  for (let index = 0; index < screenDistances.length; index += 1) {
    const distance = screenDistances[index]!
    if (!Number.isFinite(distance) || distance > closestDistance) continue
    closestDistance = distance
    closestIndex = index
  }
  return closestIndex
}

function isEffectivelyVisible(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

export function isMeasurementSurfaceMaterialVisible(object: Object3D, materialIndex = 0): boolean {
  const material = (object as Object3D & { material?: Material | Material[] }).material
  if (!material) return true
  const hitMaterial = Array.isArray(material) ? material[materialIndex] : material
  return Boolean(
    hitMaterial?.visible &&
      hitMaterial.opacity > 0.001 &&
      hitMaterial.colorWrite &&
      hitMaterial.depthTest,
  )
}

function isMeasurementSurfaceEligible(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (current.userData.measurementSurface === false) return false
    current = current.parent
  }
  return true
}

function nearestRegisteredOwner(
  object: Object3D,
  ownerByObject: Map<Object3D, string>,
): string | null {
  let current: Object3D | null = object
  while (current) {
    const owner = ownerByObject.get(current)
    if (owner) return owner
    current = current.parent
  }
  return null
}

export function collectMeasurementSurfaceRoots(
  scene: Object3D,
  registeredRoots: readonly Object3D[],
): Object3D[] {
  const roots = [...registeredRoots]
  scene.traverse((object) => {
    if (object.userData.measurementSurface !== true) return
    let ancestor: Object3D | null = object
    while (ancestor) {
      if (roots.includes(ancestor)) return
      ancestor = ancestor.parent
    }
    roots.push(object)
  })
  return roots
}

export function createMeasurementRaycastContext(
  scene: Object3D,
  options: { includeZoneLayer?: boolean } = {},
): MeasurementRaycastContext {
  const entries = Array.from(sceneRegistry.nodes.entries())
  const ownerByObject = new Map(entries.map(([id, object]) => [object, id]))
  const registeredObjects = new Set(entries.map(([, object]) => object))
  const nodes = useScene.getState().nodes as Record<string, { type: string } | undefined>
  const registeredRoots = entries
    .filter(([id, object]) => {
      const node = nodes[id]
      if (!node || node.type === 'measurement' || node.type === 'guide' || node.type === 'scan') {
        return false
      }
      if (!isEffectivelyVisible(object)) return false

      let parent = object.parent
      while (parent) {
        if (registeredObjects.has(parent)) return false
        parent = parent.parent
      }
      return true
    })
    .map(([, object]) => object)

  return {
    ownerByObject,
    roots: collectMeasurementSurfaceRoots(scene, registeredRoots),
    includeZoneLayer: options.includeZoneLayer,
  }
}

export function castVisibleMeasurementSurface(
  raycaster: Raycaster,
  context: MeasurementRaycastContext,
): WorldSurfaceHit | null {
  const hits = collectVisibleMeasurementSurfaceHits(raycaster, context)
  const nearest = hits[0] ?? null
  if (!(context.includeZoneLayer && nearest)) return nearest

  const nodes = useScene.getState().nodes as Record<string, { type: string } | undefined>
  const nearestType = nearest.targetNodeId ? nodes[nearest.targetNodeId]?.type : undefined
  if (nearestType !== 'slab') return nearest
  return (
    hits.find(
      (hit) =>
        hit.targetNodeId !== null &&
        nodes[hit.targetNodeId]?.type === 'zone' &&
        hit.intersection.distance <= nearest.intersection.distance + ZONE_SURFACE_PRIORITY_DISTANCE,
    ) ?? nearest
  )
}

function collectVisibleMeasurementSurfaceHits(
  raycaster: Raycaster,
  context: MeasurementRaycastContext,
): WorldSurfaceHit[] {
  const nodes = useScene.getState().nodes as Record<string, { type: string } | undefined>
  const intersections = raycaster.intersectObjects(context.roots, true)
  const hits: WorldSurfaceHit[] = []
  for (const intersection of intersections) {
    if (!intersection.face) continue
    const targetNodeId = nearestRegisteredOwner(intersection.object, context.ownerByObject)
    const targetType = targetNodeId ? nodes[targetNodeId]?.type : undefined
    if (
      !isEffectivelyVisible(intersection.object) ||
      !isMeasurementSurfaceEligible(intersection.object) ||
      (!isMeasurementSurfaceMaterialVisible(intersection.object, intersection.face.materialIndex) &&
        !(context.includeZoneLayer && targetType === 'zone'))
    ) {
      continue
    }
    if (targetNodeId) {
      if (
        !targetType ||
        targetType === 'measurement' ||
        targetType === 'guide' ||
        targetType === 'scan'
      ) {
        continue
      }
    }
    hits.push({ intersection, targetNodeId })
  }
  return hits
}

export function measurementIntersectionWorldNormal(intersection: Intersection<Object3D>): Vector3 {
  const object = intersection.object
  const worldMatrix = object.matrixWorld.clone()
  const instancedMesh = object as InstancedMesh
  if (instancedMesh.isInstancedMesh && intersection.instanceId !== undefined) {
    const instanceMatrix = new Matrix4()
    instancedMesh.getMatrixAt(intersection.instanceId, instanceMatrix)
    worldMatrix.multiply(instanceMatrix)
  }
  return intersection
    .face!.normal.clone()
    .applyNormalMatrix(new Matrix3().getNormalMatrix(worldMatrix))
    .normalize()
}

function toLocalSurfaceHit(hit: WorldSurfaceHit, levelObject: Object3D): LocalSurfaceHit {
  hit.intersection.object.updateWorldMatrix(true, false)
  levelObject.updateWorldMatrix(true, false)

  const point = levelObject.worldToLocal(hit.intersection.point.clone())
  const normal = measurementIntersectionWorldNormal(hit.intersection)
  const inverseLevelRotation = levelObject.getWorldQuaternion(new Quaternion()).invert()
  normal.applyQuaternion(inverseLevelRotation).normalize()

  return {
    point: [point.x, point.y, point.z],
    normal: [normal.x, normal.y, normal.z],
    targetNodeId: hit.targetNodeId,
  }
}

export function selectMeasurementSurfaceHit(
  hits: readonly WorldSurfaceHit[],
  levelObject: Object3D,
  preference: MeasurementSurfacePreference | null,
): WorldSurfaceHit | null {
  const nearest = hits[0] ?? null
  if (!(nearest && preference)) return nearest

  if (preference.kind === 'horizontal') {
    if (
      Math.abs(toLocalSurfaceHit(nearest, levelObject).normal[1]) >=
      HORIZONTAL_SURFACE_MAX_OCCLUDER_NORMAL_Y
    ) {
      return nearest
    }
    const nodes = useScene.getState().nodes as Record<string, { type: string } | undefined>
    const nearby = hits.filter(
      (hit) =>
        hit.intersection.distance <=
        nearest.intersection.distance + SURFACE_INTENT_MAX_OCCLUSION_DISTANCE,
    )
    return (
      nearby.find((hit) => {
        const type = hit.targetNodeId ? nodes[hit.targetNodeId]?.type : undefined
        return (
          Boolean(type && HORIZONTAL_SURFACE_TYPES.has(type)) &&
          Math.abs(toLocalSurfaceHit(hit, levelObject).normal[1]) >= HORIZONTAL_SURFACE_MIN_NORMAL_Y
        )
      }) ?? nearest
    )
  }

  const preferredNormal = new Vector3(...preference.normal)
  if (preferredNormal.lengthSq() <= 1e-12) return null
  preferredNormal.normalize()
  const preferredPoint = new Vector3(...preference.point)
  return (
    hits.find((hit) => {
      const localHit = toLocalSurfaceHit(hit, levelObject)
      const normalAlignment = Math.abs(preferredNormal.dot(new Vector3(...localHit.normal)))
      const planeDistance = Math.abs(
        new Vector3(...localHit.point).sub(preferredPoint).dot(preferredNormal),
      )
      return (
        normalAlignment >= SURFACE_INTENT_MIN_NORMAL_ALIGNMENT &&
        planeDistance <= SURFACE_INTENT_PLANE_TOLERANCE
      )
    }) ?? null
  )
}

function setRayFromPointer(
  raycaster: Raycaster,
  pointer: Vector2,
  event: MouseEvent | PointerEvent,
  camera: Camera,
  canvas: HTMLCanvasElement,
) {
  const rect = canvas.getBoundingClientRect()
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(pointer, camera)
}

export function worldPointScreenDistance(
  point: Vector3,
  event: MouseEvent | PointerEvent,
  camera: Camera,
  canvas: HTMLCanvasElement,
): number {
  const rect = canvas.getBoundingClientRect()
  const projected = point.clone().project(camera)
  if (!Number.isFinite(projected.z) || projected.z < -1 || projected.z > 1) {
    return Number.POSITIVE_INFINITY
  }
  const x = rect.left + ((projected.x + 1) / 2) * rect.width
  const y = rect.top + ((1 - projected.y) / 2) * rect.height
  return Math.hypot(event.clientX - x, event.clientY - y)
}

function axisGuideToPoint(
  axis: MeasurementAxis,
  from: MeasurementPoint,
  point: MeasurementPoint,
  snapped: boolean,
  proximity = false,
): MeasurementAxisGuide {
  const to: MeasurementPoint = [...from]
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  to[index] = point[index]
  return { axis, from: [...from], to, snapped, ...(proximity ? { proximity: true } : {}) }
}

function verifyProjectedSurfacePoint(
  candidateWorld: Vector3,
  surfaceNormalWorld: Vector3,
  raycaster: Raycaster,
  context: MeasurementRaycastContext,
): WorldSurfaceHit | null {
  for (const sign of [-1, 1] as const) {
    const direction = surfaceNormalWorld.clone().multiplyScalar(-sign)
    raycaster.set(
      candidateWorld.clone().addScaledVector(surfaceNormalWorld, SURFACE_VERIFY_HALF_SPAN * sign),
      direction,
    )
    raycaster.near = 0
    raycaster.far = SURFACE_VERIFY_HALF_SPAN * 2
    const hit = castVisibleMeasurementSurface(raycaster, context)
    if (hit && hit.intersection.point.distanceTo(candidateWorld) <= SURFACE_VERIFY_TOLERANCE) {
      return hit
    }
  }
  return null
}

function resolveSurfacePoint(
  args: {
    event: MouseEvent | PointerEvent
    camera: Camera
    canvas: HTMLCanvasElement
    levelObject: Object3D
    anchorOrAnchors: MeasurementPoint | readonly MeasurementPoint[] | null
    lockedGuide: MeasurementAxisGuide | null
    planarProximityAnchors: readonly AlignmentAnchor[]
    surfacePreference: MeasurementSurfacePreference | null
    applyMagneticSnap: boolean
    showAlignmentGuides: boolean
  },
  context: MeasurementRaycastContext,
  pointerRaycaster: Raycaster,
  verificationRaycaster: Raycaster,
  pointer: Vector2,
): { hit: LocalSurfaceHit; guide: MeasurementAxisGuide | null } | null {
  if (context.roots.length === 0) return null

  pointerRaycaster.near = 0
  pointerRaycaster.far = Number.POSITIVE_INFINITY
  setRayFromPointer(pointerRaycaster, pointer, args.event, args.camera, args.canvas)
  const rawWorldHit = args.surfacePreference
    ? selectMeasurementSurfaceHit(
        collectVisibleMeasurementSurfaceHits(pointerRaycaster, context),
        args.levelObject,
        args.surfacePreference,
      )
    : castVisibleMeasurementSurface(pointerRaycaster, context)
  if (!rawWorldHit) return null
  const rawHit = toLocalSurfaceHit(rawWorldHit, args.levelObject)
  const anchors: readonly MeasurementPoint[] = !args.anchorOrAnchors
    ? []
    : typeof args.anchorOrAnchors[0] === 'number'
      ? [args.anchorOrAnchors as MeasurementPoint]
      : (args.anchorOrAnchors as readonly MeasurementPoint[])
  const supportsPlanarProximity = Math.abs(rawHit.normal[1]) >= 0.65
  if (
    (!args.showAlignmentGuides && !args.applyMagneticSnap) ||
    (anchors.length === 0 && (!supportsPlanarProximity || args.planarProximityAnchors.length === 0))
  ) {
    return { hit: rawHit, guide: null }
  }

  args.levelObject.updateWorldMatrix(true, false)
  const levelRotation = args.levelObject.getWorldQuaternion(new Quaternion())
  const rawNormalWorld = new Vector3(...rawHit.normal).applyQuaternion(levelRotation).normalize()
  const projectedCandidates = [
    ...anchors.flatMap((anchor) =>
      projectMeasurementPointToAxes(anchor, rawHit.point).map((candidate) => ({
        ...candidate,
        anchor,
        proximity: false,
      })),
    ),
    ...(supportsPlanarProximity
      ? args.planarProximityAnchors.flatMap((proximityAnchor) => {
          const anchor: MeasurementPoint = [proximityAnchor.x, rawHit.point[1], proximityAnchor.z]
          return projectMeasurementPointToPlanarAxes(anchor, rawHit.point).map((candidate) => ({
            ...candidate,
            anchor,
            proximity: true,
          }))
        })
      : []),
  ].map((candidate) => {
    const candidateWorld = args.levelObject.localToWorld(new Vector3(...candidate.point))
    return {
      ...candidate,
      candidateWorld,
      screenDistance: worldPointScreenDistance(
        candidateWorld,
        args.event,
        args.camera,
        args.canvas,
      ),
      verified: false,
      verifiedHit: null as WorldSurfaceHit | null,
    }
  })
  const lockedGuide = args.applyMagneticSnap ? args.lockedGuide : null
  if (args.applyMagneticSnap) {
    const candidateToVerify = selectAxisCandidateForSurfaceVerification(
      projectedCandidates,
      AXIS_SNAP_DISTANCE_PX,
      lockedGuide?.axis ?? null,
      AXIS_SNAP_RELEASE_DISTANCE_PX,
      lockedGuide?.from ?? null,
    )
    if (candidateToVerify) {
      const verifiedHit = verifyProjectedSurfacePoint(
        candidateToVerify.candidateWorld,
        rawNormalWorld,
        verificationRaycaster,
        { ownerByObject: context.ownerByObject, roots: [rawWorldHit.intersection.object] },
      )
      candidateToVerify.verified = verifiedHit !== null
      candidateToVerify.verifiedHit = verifiedHit
    }
  }
  const selected = args.applyMagneticSnap
    ? selectClosestAxisCandidate(
        projectedCandidates,
        AXIS_SNAP_DISTANCE_PX,
        lockedGuide?.axis ?? null,
        AXIS_SNAP_RELEASE_DISTANCE_PX,
        lockedGuide?.from ?? null,
      )
    : null

  if (selected?.verifiedHit) {
    const surfaceHit = toLocalSurfaceHit(selected.verifiedHit, args.levelObject)
    const guide = axisGuideToPoint(
      selected.axis,
      selected.anchor!,
      selected.point,
      true,
      selected.proximity,
    )
    return {
      hit: { ...surfaceHit, point: [...selected.point] },
      guide: args.showAlignmentGuides ? guide : null,
    }
  }

  const passive = projectedCandidates
    .filter(
      (candidate) =>
        !candidate.proximity || candidate.screenDistance <= PROXIMITY_GUIDE_DISTANCE_PX,
    )
    .reduce<(typeof projectedCandidates)[number] | null>(
      (closest, candidate) =>
        !closest || candidate.screenDistance < closest.screenDistance ? candidate : closest,
      null,
    )
  return {
    hit: rawHit,
    guide:
      args.showAlignmentGuides && passive
        ? axisGuideToPoint(passive.axis, passive.anchor!, passive.point, false, passive.proximity)
        : null,
  }
}

function collectMeasurementAxisSurfaceIntersections(
  context: MeasurementRaycastContext,
  levelObject: Object3D,
  anchor: MeasurementPoint,
  raycaster: Raycaster,
  maxDistance: number,
): MeasurementAxisSurfaceIntersection[] {
  if (!(Number.isFinite(maxDistance) && maxDistance > AXIS_INTERSECTION_MIN_DISTANCE)) return []
  if (context.roots.length === 0) return []

  levelObject.updateWorldMatrix(true, false)
  const origin = levelObject.localToWorld(new Vector3(...anchor))
  const levelRotation = levelObject.getWorldQuaternion(new Quaternion())
  const inverseLevelRotation = levelRotation.clone().invert()
  raycaster.layers.set(SCENE_LAYER)
  raycaster.near = 0
  raycaster.far = maxDistance
  const intersections: MeasurementAxisSurfaceIntersection[] = []

  for (const axis of ['x', 'y', 'z'] as const) {
    const localDirection =
      axis === 'x'
        ? new Vector3(1, 0, 0)
        : axis === 'y'
          ? new Vector3(0, 1, 0)
          : new Vector3(0, 0, 1)
    for (const sign of [-1, 1] as const) {
      const direction = localDirection
        .clone()
        .multiplyScalar(sign)
        .applyQuaternion(levelRotation)
        .normalize()
      raycaster.set(
        origin.clone().addScaledVector(direction, AXIS_INTERSECTION_MIN_DISTANCE),
        direction,
      )
      const hits = collectVisibleMeasurementSurfaceHits(raycaster, context)
      let accepted = 0
      for (const hit of hits) {
        const worldDistance = hit.intersection.point.distanceTo(origin)
        if (
          worldDistance < AXIS_INTERSECTION_MIN_DISTANCE ||
          worldDistance > maxDistance + AXIS_INTERSECTION_MIN_DISTANCE
        ) {
          continue
        }
        const local = levelObject.worldToLocal(hit.intersection.point.clone())
        const point: MeasurementPoint = [local.x, local.y, local.z]
        if (
          intersections.some(
            (candidate) =>
              candidate.axis === axis && measurementDistance(candidate.point, point) < 0.025,
          )
        ) {
          continue
        }
        const normal = measurementIntersectionWorldNormal(hit.intersection)
          .applyQuaternion(inverseLevelRotation)
          .normalize()
        intersections.push({ axis, point, normal: [normal.x, normal.y, normal.z] })
        accepted += 1
        if (accepted >= MAX_AXIS_INTERSECTIONS_PER_DIRECTION) break
      }
    }
  }

  return intersections
}

export function createMeasurementSurfaceQuerySession(
  scene: Object3D,
  options: { includeZoneLayer?: boolean } = {},
): MeasurementSurfaceQuerySession {
  const pointerRaycaster = new Raycaster()
  const verificationRaycaster = new Raycaster()
  const axisRaycaster = new Raycaster()
  const pointer = new Vector2()
  pointerRaycaster.layers.set(SCENE_LAYER)
  verificationRaycaster.layers.set(SCENE_LAYER)
  axisRaycaster.layers.set(SCENE_LAYER)
  if (options.includeZoneLayer) pointerRaycaster.layers.enable(ZONE_LAYER)

  let context: MeasurementRaycastContext | null = null
  let revision = -1
  let refreshedAt = Number.NEGATIVE_INFINITY

  const getContext = () => {
    const now = performance.now()
    if (
      !context ||
      revision !== sceneRegistry.revision ||
      now - refreshedAt >= UNREGISTERED_ROOT_REFRESH_MS
    ) {
      context = createMeasurementRaycastContext(scene, options)
      revision = sceneRegistry.revision
      refreshedAt = now
    }
    return context
  }

  const invalidate = () => {
    context = null
    revision = -1
    refreshedAt = Number.NEGATIVE_INFINITY
  }

  return {
    resolvePointer: (args) =>
      resolveSurfacePoint(
        {
          ...args,
          lockedGuide: args.lockedGuide ?? null,
          planarProximityAnchors: args.planarProximityAnchors ?? [],
          surfacePreference: args.surfacePreference ?? null,
        },
        getContext(),
        pointerRaycaster,
        verificationRaycaster,
        pointer,
      ),
    collectAxisIntersections: ({ levelObject, anchor, maxDistance = 20 }) =>
      collectMeasurementAxisSurfaceIntersections(
        getContext(),
        levelObject,
        anchor,
        axisRaycaster,
        maxDistance,
      ),
    invalidate,
    dispose: invalidate,
  }
}

export function associateSurfaceHit(
  hit: LocalSurfaceHit,
  maxDistance = SEMANTIC_FEATURE_SNAP_DISTANCE,
): LocalSurfaceHit & {
  anchor?: MeasurementFeatureAnchor
  semantic?: {
    label: string
    length: number | null
    snapKind: MeasurementSnapKind
  }
} {
  if (!hit.targetNodeId) return hit
  const nodes = useScene.getState().nodes
  const node = nodes[hit.targetNodeId as AnyNodeId]
  if (!node) return hit
  const match = matchMeasurementFeatureForNode(node, (id) => nodes[id], hit.point, maxDistance)
  if (!match) return hit
  return {
    ...hit,
    point: match.point,
    anchor: {
      kind: 'feature',
      reference: {
        nodeId: node.id,
        featureId: match.feature.id,
        parameters: match.parameters,
      },
      fallback: match.point,
    },
    semantic: {
      label: match.feature.label,
      length: measurementFeatureLength(match.feature),
      snapKind: match.feature.snapKind,
    },
  }
}
