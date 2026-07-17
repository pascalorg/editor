'use client'

import {
  type AlignmentAnchor,
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  type MeasurementFeatureAnchor,
  type MeasurementSnapKind,
  measurementAngle,
  measurementArea,
  measurementCentroid,
  measurementDistance,
  measurementFeatureLength,
  measurementPerimeter,
  measurementPrismVolume,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  buildMeasurementAngleArcPoints,
  commitMeasurementDraft,
  EDITOR_LAYER,
  finishMeasurementDraft,
  formatAngleRadians,
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  getLinearUnitLabel,
  isAlignmentGuideActive,
  isGridSnapActive,
  type LinearUnit,
  linearUnitToMeters,
  MEASUREMENT_ACTIVE_COLOR,
  type MeasurementAxis,
  type MeasurementAxisGuide,
  type MeasurementPoint,
  markToolCancelConsumed,
  measurementPolygonLabelAnchor,
  measurementPolygonMidpoints,
  metersToLinearUnit,
  useEditor,
  useInteractionScope,
  useMeasurementDraft,
} from '@pascal-app/editor'
import { SCENE_LAYER, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  type Camera,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type InstancedMesh,
  type Intersection,
  type Material,
  MathUtils,
  Matrix3,
  Matrix4,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { matchMeasurementFeatureForNode } from './resolve'
import {
  createMeasurementSurfaceQuerySession,
  type MeasurementSurfaceQuerySession,
  type MeasurementAxisSurfaceIntersection as QueriedAxisSurfaceIntersection,
} from './surface-query'

const AXIS_SNAP_DISTANCE_PX = 16
const AXIS_SNAP_RELEASE_DISTANCE_PX = 24
const PROXIMITY_GUIDE_DISTANCE_PX = 40
const VERTEX_HANDLE_DISTANCE_PX = 12
const MIDPOINT_HANDLE_DISTANCE_PX = 10
const VERTEX_DRAG_ACTIVATION_PX = 4
const AXIS_GUIDE_HALF_LENGTH = 20
const AXIS_INTERSECTION_MARKER_RADIUS_PX = 8
const SURFACE_RETICLE_RADIUS_PX = 16
const MAX_DRAFT_DASH_SEGMENTS = 512
const SURFACE_VERIFY_HALF_SPAN = 0.08
const SURFACE_VERIFY_TOLERANCE = 0.012
const SEMANTIC_FEATURE_SNAP_DISTANCE = 0.2
const AXIS_INTERSECTION_MIN_DISTANCE = 0.05
const MAX_AXIS_INTERSECTIONS_PER_DIRECTION = 4
const DRAFT_COLOR = MEASUREMENT_ACTIVE_COLOR
const RETICLE_COLOR = MEASUREMENT_ACTIVE_COLOR
const GUIDE_COLORS: Record<MeasurementAxis, string> = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
}
const RETICLE_PLANE_NORMAL = new Vector3(0, 0, 1)
const RETICLE_NORMAL_POINTS = [new Vector3(0, 0, 0), new Vector3(0, 0, 0.9)]
const NO_RAYCAST = () => {}

export type MeasurementRaycastContext = {
  ownerByObject: Map<Object3D, string>
  roots: Object3D[]
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

export type MeasurementAxisProjection = {
  axis: MeasurementAxis
  point: MeasurementPoint
}

export type MeasurementAxisSurfaceIntersection = {
  axis: MeasurementAxis
  point: MeasurementPoint
}

type MeasurementAxisCandidate = MeasurementAxisProjection & {
  anchor?: MeasurementPoint
  proximity?: boolean
  screenDistance: number
  verified: boolean
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
  if (!Number.isInteger(index) || index < 0 || index >= points.length || points.length < 2)
    return []
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

function isMeasurementKind(
  value: unknown,
): value is 'distance' | 'angle' | 'area' | 'perimeter' | 'volume' {
  return (
    value === 'distance' ||
    value === 'angle' ||
    value === 'area' ||
    value === 'perimeter' ||
    value === 'volume'
  )
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

export function isMeasurementSurfaceEligible(object: Object3D): boolean {
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

function getMeasurementRaycastContext(scene: Object3D): MeasurementRaycastContext {
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
  }
}

export function castVisibleMeasurementSurface(
  raycaster: Raycaster,
  context: MeasurementRaycastContext,
): WorldSurfaceHit | null {
  return collectVisibleMeasurementSurfaceHits(raycaster, context)[0] ?? null
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
    if (
      !isEffectivelyVisible(intersection.object) ||
      !isMeasurementSurfaceEligible(intersection.object) ||
      !isMeasurementSurfaceMaterialVisible(intersection.object, intersection.face.materialIndex)
    )
      continue
    const targetNodeId = nearestRegisteredOwner(intersection.object, context.ownerByObject)
    if (targetNodeId) {
      const type = nodes[targetNodeId]?.type
      if (!type || type === 'measurement' || type === 'guide' || type === 'scan') continue
    }
    hits.push({ intersection, targetNodeId })
  }
  return hits
}

export function collectMeasurementAxisSurfaceIntersections(
  scene: Object3D,
  levelObject: Object3D,
  anchor: MeasurementPoint,
  maxDistance = AXIS_GUIDE_HALF_LENGTH,
): MeasurementAxisSurfaceIntersection[] {
  if (!(Number.isFinite(maxDistance) && maxDistance > AXIS_INTERSECTION_MIN_DISTANCE)) return []
  const context = getMeasurementRaycastContext(scene)
  if (context.roots.length === 0) return []

  levelObject.updateWorldMatrix(true, false)
  const origin = levelObject.localToWorld(new Vector3(...anchor))
  const levelRotation = levelObject.getWorldQuaternion(new Quaternion())
  const raycaster = new Raycaster()
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
        intersections.push({ axis, point })
        accepted += 1
        if (accepted >= MAX_AXIS_INTERSECTIONS_PER_DIRECTION) break
      }
    }
  }

  return intersections
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

function worldPointScreenDistance(
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
  return {
    axis,
    from: [...from],
    to,
    snapped,
    ...(proximity ? { proximity: true } : {}),
  }
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

export function resolveSurfacePoint(
  event: MouseEvent | PointerEvent,
  camera: Camera,
  canvas: HTMLCanvasElement,
  raycaster: Raycaster,
  pointer: Vector2,
  scene: Object3D,
  levelObject: Object3D,
  anchorOrAnchors: MeasurementPoint | readonly MeasurementPoint[] | null,
  lockedGuide: MeasurementAxisGuide | null = null,
  planarProximityAnchors: readonly AlignmentAnchor[] = [],
): { hit: LocalSurfaceHit; guide: MeasurementAxisGuide | null } | null {
  const context = getMeasurementRaycastContext(scene)
  if (context.roots.length === 0) return null

  raycaster.near = 0
  raycaster.far = Number.POSITIVE_INFINITY
  setRayFromPointer(raycaster, pointer, event, camera, canvas)
  const rawWorldHit = castVisibleMeasurementSurface(raycaster, context)
  if (!rawWorldHit) return null
  const rawHit = toLocalSurfaceHit(rawWorldHit, levelObject)
  const anchors: readonly MeasurementPoint[] = !anchorOrAnchors
    ? []
    : typeof anchorOrAnchors[0] === 'number'
      ? [anchorOrAnchors as MeasurementPoint]
      : (anchorOrAnchors as readonly MeasurementPoint[])
  const supportsPlanarProximity = Math.abs(rawHit.normal[1]) >= 0.65
  if (anchors.length === 0 && (!supportsPlanarProximity || planarProximityAnchors.length === 0)) {
    return { hit: rawHit, guide: null }
  }

  levelObject.updateWorldMatrix(true, false)
  const levelRotation = levelObject.getWorldQuaternion(new Quaternion())
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
      ? planarProximityAnchors.flatMap((proximityAnchor) => {
          const anchor: MeasurementPoint = [proximityAnchor.x, rawHit.point[1], proximityAnchor.z]
          return projectMeasurementPointToPlanarAxes(anchor, rawHit.point).map((candidate) => ({
            ...candidate,
            anchor,
            proximity: true,
          }))
        })
      : []),
  ].map((candidate) => {
    const candidateWorld = levelObject.localToWorld(new Vector3(...candidate.point))
    return {
      ...candidate,
      candidateWorld,
      screenDistance: worldPointScreenDistance(candidateWorld, event, camera, canvas),
      verified: false,
      verifiedHit: null as WorldSurfaceHit | null,
    }
  })
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
      raycaster,
      {
        ownerByObject: context.ownerByObject,
        roots: [rawWorldHit.intersection.object],
      },
    )
    candidateToVerify.verified = verifiedHit !== null
    candidateToVerify.verifiedHit = verifiedHit
  }
  const selected = selectClosestAxisCandidate(
    projectedCandidates,
    AXIS_SNAP_DISTANCE_PX,
    lockedGuide?.axis ?? null,
    AXIS_SNAP_RELEASE_DISTANCE_PX,
    lockedGuide?.from ?? null,
  )

  if (selected) {
    if (selected.verifiedHit) {
      const surfaceHit = toLocalSurfaceHit(selected.verifiedHit, levelObject)
      const guide = axisGuideToPoint(
        selected.axis,
        selected.anchor!,
        selected.point,
        true,
        selected.proximity,
      )
      return { hit: { ...surfaceHit, point: [...selected.point] }, guide }
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
    guide: passive
      ? axisGuideToPoint(passive.axis, passive.anchor!, passive.point, false, passive.proximity)
      : null,
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

export function closestMeasurementExtrusionHeight(
  rayOrigin: MeasurementPoint,
  rayDirection: MeasurementPoint,
  axisOrigin: MeasurementPoint,
  axisDirection: MeasurementPoint,
): number | null {
  const originDelta = new Vector3(...rayOrigin).sub(new Vector3(...axisOrigin))
  const ray = new Vector3(...rayDirection).normalize()
  const axis = new Vector3(...axisDirection).normalize()
  const b = ray.dot(axis)
  const denominator = 1 - b * b
  if (Math.abs(denominator) < 1e-6) return null
  const d = ray.dot(originDelta)
  const e = axis.dot(originDelta)
  const height = (e - b * d) / denominator
  return Number.isFinite(height) ? height : null
}

export function parseMeasurementExtrusionHeight(value: string, unit: LinearUnit): number | null {
  const numericValue = Number.parseFloat(value)
  return Number.isFinite(numericValue) ? linearUnitToMeters(numericValue, unit) : null
}

function extrusionHeightFromPointer(
  event: MouseEvent | PointerEvent,
  camera: Camera,
  canvas: HTMLCanvasElement,
  raycaster: Raycaster,
  pointer: Vector2,
  levelObject: Object3D,
  base: MeasurementPoint[],
  normal: MeasurementPoint,
): number | null {
  const centroid = measurementCentroid(base)
  if (!centroid) return null

  setRayFromPointer(raycaster, pointer, event, camera, canvas)
  const axisOrigin = levelObject.localToWorld(new Vector3(...centroid))
  const levelRotation = levelObject.getWorldQuaternion(new Quaternion())
  const axisDirection = new Vector3(...normal).applyQuaternion(levelRotation).normalize()
  let height = closestMeasurementExtrusionHeight(
    [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
    [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
    [axisOrigin.x, axisOrigin.y, axisOrigin.z],
    [axisDirection.x, axisDirection.y, axisDirection.z],
  )
  if (height === null) return null

  if (isGridSnapActive()) {
    const step = useEditor.getState().gridSnapStep
    if (step > 0) height = Math.round(height / step) * step
  }
  return height
}

function shouldIgnoreKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement)
  )
}

function localToPreviewFrame(
  levelObject: Object3D,
  buildingObject: Object3D | null,
  point: MeasurementPoint,
): Vector3 {
  const worldPoint = levelObject.localToWorld(new Vector3(...point))
  return buildingObject ? buildingObject.worldToLocal(worldPoint) : worldPoint
}

export function localNormalToPreviewFrame(
  levelObject: Object3D,
  buildingObject: Object3D | null,
  normal: MeasurementPoint,
): Vector3 {
  levelObject.updateWorldMatrix(true, false)
  buildingObject?.updateWorldMatrix(true, false)
  const result = new Vector3(...normal).applyQuaternion(
    levelObject.getWorldQuaternion(new Quaternion()),
  )
  if (buildingObject) {
    result.applyQuaternion(buildingObject.getWorldQuaternion(new Quaternion()).invert())
  }
  return result.normalize()
}

function midpoint(start: MeasurementPoint, end: MeasurementPoint): MeasurementPoint {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2]
}

export function buildMeasurementDraftLinePositions(
  points: readonly Vector3[],
  dashSize = 0,
  gapSize = 0,
): number[] {
  const positions: number[] = []
  const isFiniteFloat32 = (value: number) => Number.isFinite(Math.fround(value))
  const pushSegment = (start: Vector3, end: Vector3) => {
    const coordinates = [start.x, start.y, start.z, end.x, end.y, end.z]
    if (!coordinates.every(isFiniteFloat32)) return
    positions.push(...coordinates)
  }
  const dashed =
    Number.isFinite(dashSize) &&
    dashSize > 0 &&
    Number.isFinite(gapSize) &&
    gapSize >= 0 &&
    dashSize + gapSize > 0

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!
    const end = points[index + 1]!
    if (
      !isFiniteFloat32(start.x) ||
      !isFiniteFloat32(start.y) ||
      !isFiniteFloat32(start.z) ||
      !isFiniteFloat32(end.x) ||
      !isFiniteFloat32(end.y) ||
      !isFiniteFloat32(end.z)
    ) {
      continue
    }

    const delta = end.clone().sub(start)
    if (delta.lengthSq() <= 1e-18) continue
    if (!dashed) {
      pushSegment(start, end)
      continue
    }

    const length = delta.length()
    if (!Number.isFinite(length) || length <= 1e-9) continue
    const direction = delta.multiplyScalar(1 / length)
    const requestedStride = dashSize + gapSize
    const requestedCount = Math.ceil(length / requestedStride)
    const dashCount = Math.min(requestedCount, MAX_DRAFT_DASH_SEGMENTS)
    const stride = requestedCount > dashCount ? length / dashCount : requestedStride
    const effectiveDashSize = stride * (dashSize / requestedStride)

    for (let dashIndex = 0; dashIndex < dashCount; dashIndex++) {
      const offset = dashIndex * stride
      const segmentEnd = Math.min(offset + effectiveDashSize, length)
      if (segmentEnd <= offset) break
      const from = start.clone().addScaledVector(direction, offset)
      const to = start.clone().addScaledVector(direction, segmentEnd)
      pushSegment(from, to)
    }
  }

  return positions
}

function DraftLine({
  color,
  dashSize = 0,
  gapSize = 0,
  lineWidth = 1,
  opacity = 1,
  points,
}: {
  color: string
  dashSize?: number
  gapSize?: number
  lineWidth?: number
  opacity?: number
  points: readonly Vector3[]
}) {
  const geometry = useMemo(() => {
    const next = new BufferGeometry()
    next.setAttribute(
      'position',
      new Float32BufferAttribute(buildMeasurementDraftLinePositions(points, dashSize, gapSize), 3),
    )
    return next
  }, [dashSize, gapSize, points])

  useEffect(() => () => geometry.dispose(), [geometry])
  if (geometry.getAttribute('position').count < 2) return null

  return (
    <lineSegments
      frustumCulled={false}
      geometry={geometry}
      layers={EDITOR_LAYER}
      raycast={NO_RAYCAST}
      renderOrder={1001}
      userData={{ measurementSurface: false }}
    >
      <lineBasicNodeMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        linewidth={lineWidth}
        opacity={opacity}
        transparent
      />
    </lineSegments>
  )
}

function useScreenSizedGroup(radiusPx: number, maxScale: number) {
  const ref = useRef<Group>(null)
  const worldPosition = useMemo(() => new Vector3(), [])
  const cameraSpacePosition = useMemo(() => new Vector3(), [])

  useFrame(({ camera, size }) => {
    const group = ref.current
    if (!group) return
    group.getWorldPosition(worldPosition)
    let worldUnitsPerPixel = 0.01
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as PerspectiveCamera
      const cameraDepth = Math.abs(
        cameraSpacePosition.copy(worldPosition).applyMatrix4(perspective.matrixWorldInverse).z,
      )
      worldUnitsPerPixel =
        (2 * cameraDepth * Math.tan(MathUtils.degToRad(perspective.getEffectiveFOV() * 0.5))) /
        Math.max(size.height, 1)
    } else if ((camera as OrthographicCamera).isOrthographicCamera) {
      const orthographic = camera as OrthographicCamera
      worldUnitsPerPixel =
        (orthographic.top - orthographic.bottom) / Math.max(orthographic.zoom * size.height, 1)
    }
    const scale = worldUnitsPerPixel * radiusPx
    if (Number.isFinite(scale)) group.scale.setScalar(MathUtils.clamp(scale, 0.002, maxScale))
  })

  return ref
}

function AxisSurfaceIntersectionMarker({
  active,
  axis,
  locked,
  normal,
  position,
}: {
  active: boolean
  axis: MeasurementAxis
  locked: boolean
  normal: Vector3
  position: Vector3
}) {
  const emphasis = locked ? 1.35 : active ? 1.16 : 1
  const ref = useScreenSizedGroup(AXIS_INTERSECTION_MARKER_RADIUS_PX * emphasis, 0.32)
  const rotation = useMemo(
    () =>
      new Quaternion().setFromUnitVectors(
        RETICLE_PLANE_NORMAL,
        normal.lengthSq() > 1e-12 ? normal.clone().normalize() : RETICLE_PLANE_NORMAL,
      ),
    [normal],
  )
  const materials = useMemo(
    () => ({
      halo: new MeshBasicNodeMaterial({
        color: '#f8fafc',
        depthTest: true,
        depthWrite: false,
        opacity: active ? 0.95 : 0.78,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: DoubleSide,
        transparent: true,
      }),
      target: new MeshBasicNodeMaterial({
        color: GUIDE_COLORS[axis],
        depthTest: true,
        depthWrite: false,
        opacity: active ? 1 : 0.86,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        side: DoubleSide,
        transparent: true,
      }),
    }),
    [active, axis],
  )

  useEffect(
    () => () => {
      materials.halo.dispose()
      materials.target.dispose()
    },
    [materials],
  )

  return (
    <group
      position={position}
      quaternion={rotation}
      ref={ref}
      userData={{ measurementSurface: false }}
    >
      <mesh layers={EDITOR_LAYER} material={materials.halo} raycast={NO_RAYCAST} renderOrder={1002}>
        <ringGeometry args={[0.48, 1, 40]} />
      </mesh>
      <mesh
        layers={EDITOR_LAYER}
        material={materials.target}
        raycast={NO_RAYCAST}
        renderOrder={1003}
      >
        <ringGeometry args={[0.62, 0.86, 40]} />
      </mesh>
    </group>
  )
}

function SurfaceReticle({
  activeAxis,
  axisDirections,
  normal,
  position,
  snappedAxis,
}: {
  activeAxis: MeasurementAxis | null
  axisDirections: Record<MeasurementAxis, Vector3>
  normal: Vector3
  position: Vector3
  snappedAxis: MeasurementAxis | null
}) {
  const ref = useScreenSizedGroup(SURFACE_RETICLE_RADIUS_PX, 0.5)
  const rotation = useMemo(
    () =>
      new Quaternion().setFromUnitVectors(
        RETICLE_PLANE_NORMAL,
        normal.lengthSq() > 1e-12 ? normal.clone().normalize() : RETICLE_PLANE_NORMAL,
      ),
    [normal],
  )
  const counterRotation = useMemo(() => rotation.clone().invert(), [rotation])
  const axisPoints = useMemo(
    () =>
      Object.fromEntries(
        (['x', 'y', 'z'] as const).map((axis) => {
          const direction = axisDirections[axis].clone().normalize().multiplyScalar(0.68)
          return [axis, [direction.clone().negate(), direction]]
        }),
      ) as Record<MeasurementAxis, Vector3[]>,
    [axisDirections],
  )
  const color = snappedAxis ? GUIDE_COLORS[snappedAxis] : RETICLE_COLOR
  const materials = useMemo(
    () => ({
      center: new MeshBasicNodeMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      }),
      inner: new MeshBasicNodeMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        opacity: 0.72,
        side: DoubleSide,
        transparent: true,
      }),
      outer: new MeshBasicNodeMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        opacity: 0.95,
        side: DoubleSide,
        transparent: true,
      }),
    }),
    [color],
  )

  useEffect(
    () => () => {
      materials.center.dispose()
      materials.inner.dispose()
      materials.outer.dispose()
    },
    [materials],
  )

  return (
    <group
      position={position}
      quaternion={rotation}
      ref={ref}
      userData={{ measurementSurface: false }}
    >
      <mesh
        layers={EDITOR_LAYER}
        material={materials.outer}
        raycast={NO_RAYCAST}
        renderOrder={1003}
      >
        <ringGeometry args={[0.78, 1, 48]} />
      </mesh>
      <mesh
        layers={EDITOR_LAYER}
        material={materials.inner}
        raycast={NO_RAYCAST}
        renderOrder={1003}
      >
        <ringGeometry args={[0.42, 0.54, 48]} />
      </mesh>
      <mesh
        layers={EDITOR_LAYER}
        material={materials.center}
        raycast={NO_RAYCAST}
        renderOrder={1004}
      >
        <circleGeometry args={[0.12, 24]} />
      </mesh>
      <group quaternion={counterRotation}>
        {(Object.keys(GUIDE_COLORS) as MeasurementAxis[]).map((axis) => (
          <DraftLine
            color={GUIDE_COLORS[axis]}
            key={`measurement-reticle-${axis}`}
            lineWidth={activeAxis === axis ? (snappedAxis === axis ? 3 : 2.25) : 1.1}
            opacity={activeAxis === axis ? 1 : 0.52}
            points={axisPoints[axis]}
          />
        ))}
      </group>
      <DraftLine color={color} lineWidth={1.5} points={RETICLE_NORMAL_POINTS} />
    </group>
  )
}

function DraftLabel({
  position,
  children,
  appearance = 'plate',
  offset = false,
  tone = 'primary',
}: {
  position: Vector3
  children: React.ReactNode
  appearance?: 'plate' | 'outlined'
  offset?: boolean
  tone?: 'primary' | 'secondary' | 'error'
}) {
  return (
    <Html center position={position} style={{ pointerEvents: 'none' }} zIndexRange={[90, 0]}>
      <div
        className={`whitespace-nowrap text-[11px] ${offset ? '-translate-y-4' : ''} ${
          appearance === 'outlined'
            ? 'font-medium text-white'
            : `rounded-full border bg-background/95 px-2.5 py-1 font-mono font-semibold tabular-nums shadow-sm backdrop-blur ${
                tone === 'error'
                  ? 'border-red-700/70 text-red-700 dark:border-red-400/70 dark:text-red-400'
                  : tone === 'secondary'
                    ? 'border-border/50 text-muted-foreground'
                    : 'border-indigo-400/70 text-foreground'
              }`
        }`}
        style={
          appearance === 'outlined'
            ? {
                textShadow: `-1px -1px 0 ${DRAFT_COLOR}, 1px -1px 0 ${DRAFT_COLOR}, -1px 1px 0 ${DRAFT_COLOR}, 1px 1px 0 ${DRAFT_COLOR}`,
              }
            : undefined
        }
      >
        {children}
      </div>
    </Html>
  )
}

function DraftExtrusionControl({ position }: { position: Vector3 }) {
  const unit = useViewer((state) => state.unit)
  const extrusionHeight = useMeasurementDraft((state) => state.extrusionHeight)
  const points = useMeasurementDraft((state) => state.points)
  const baseNormal = useMeasurementDraft((state) => state.baseNormal)
  const [value, setValue] = useState(() =>
    extrusionHeight === 0 ? '' : String(metersToLinearUnit(extrusionHeight, unit)),
  )
  const isEditing = useRef(false)

  useEffect(() => {
    if (isEditing.current) return
    setValue(
      extrusionHeight === 0
        ? ''
        : String(Number(metersToLinearUnit(extrusionHeight, unit).toFixed(3))),
    )
  }, [extrusionHeight, unit])

  const updateHeight = (next: string) => {
    setValue(next)
    useMeasurementDraft
      .getState()
      .setExtrusionHeight('3d', parseMeasurementExtrusionHeight(next, unit) ?? 0)
  }

  const commit = () => {
    const height = parseMeasurementExtrusionHeight(value, unit)
    if (height === null) {
      useMeasurementDraft.getState().setExtrusionHeight('3d', 0)
      return
    }
    const draft = useMeasurementDraft.getState()
    draft.setExtrusionHeight('3d', height)
    if (draft.finishExtrusion('3d')) commitMeasurementDraft('3d')
  }
  const extrusion: MeasurementPoint = baseNormal
    ? [
        baseNormal[0] * extrusionHeight,
        baseNormal[1] * extrusionHeight,
        baseNormal[2] * extrusionHeight,
      ]
    : [0, 0, 0]
  const volumeLabel = formatVolumeLabel(measurementPrismVolume(points, extrusion), unit)

  return (
    <Html center position={position} style={{ pointerEvents: 'auto' }} zIndexRange={[100, 0]}>
      <div
        className="flex w-[300px] translate-y-9 items-center gap-1.5 rounded-md border border-border/70 bg-background/95 p-1.5 text-foreground shadow-lg"
        data-measurement-extrusion-control
        onClick={(event) => {
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
        }}
      >
        <label className="sr-only" htmlFor="measurement-3d-extrusion-height">
          Extrusion height
        </label>
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center font-medium text-muted-foreground text-xs">
            H
          </span>
          <input
            aria-label="Extrusion height"
            className="h-8 w-full rounded-md border border-border bg-background pr-7 pl-6 text-sm outline-none focus:border-indigo-400"
            id="measurement-3d-extrusion-height"
            inputMode="decimal"
            onBlur={() => {
              isEditing.current = false
              const height = useMeasurementDraft.getState().extrusionHeight
              setValue(
                height === 0 ? '' : String(Number(metersToLinearUnit(height, unit).toFixed(3))),
              )
            }}
            onChange={(event) => updateHeight(event.target.value)}
            onFocus={() => {
              isEditing.current = true
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              }
            }}
            placeholder="0"
            step="0.1"
            type="number"
            value={value}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground text-xs">
            {getLinearUnitLabel(unit)}
          </span>
        </div>
        <span className="shrink-0 font-mono font-semibold text-[11px] tabular-nums text-foreground">
          V {volumeLabel}
        </span>
        <button
          className="h-8 shrink-0 rounded-full bg-indigo-500 px-3 font-medium text-white text-xs disabled:cursor-not-allowed disabled:opacity-40"
          disabled={Math.abs(extrusionHeight) < 0.001}
          onClick={commit}
          type="button"
        >
          Create
        </button>
      </div>
    </Html>
  )
}

const MeasurementDraftPreview: FC<{
  buildingId: string | null
  levelId: string | null
  surfaceQuery: MeasurementSurfaceQuerySession
}> = ({ buildingId, levelId, surfaceQuery }) => {
  const capturedLevelId = useMeasurementDraft((state) => state.levelId)
  const points = useMeasurementDraft((state) => state.points)
  const hover = useMeasurementDraft((state) => state.hover)
  const hoverOwner = useMeasurementDraft((state) => state.hoverOwner)
  const kind = useMeasurementDraft((state) => state.kind)
  const stage = useMeasurementDraft((state) => state.stage)
  const axisGuide = useMeasurementDraft((state) => state.axisGuide)
  const vertexDrag = useMeasurementDraft((state) => state.vertexDrag)
  const baseNormal = useMeasurementDraft((state) => state.baseNormal)
  const extrusionHeight = useMeasurementDraft((state) => state.extrusionHeight)
  const error = useMeasurementDraft((state) => state.error)
  const unit = useViewer((state) => state.unit)
  const axisIntersectionCache = useRef<{
    intersections: QueriedAxisSurfaceIntersection[]
    key: string
    timestamp: number
  } | null>(null)
  const draftPointMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: DRAFT_COLOR,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const draftActivePointMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#f8fafc',
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const draftMidpointMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#a3e635',
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        transparent: true,
      }),
    [],
  )

  useEffect(
    () => () => {
      draftPointMaterial.dispose()
      draftActivePointMaterial.dispose()
      draftMidpointMaterial.dispose()
    },
    [draftActivePointMaterial, draftMidpointMaterial, draftPointMaterial],
  )

  const preview = useMemo(() => {
    if (capturedLevelId && capturedLevelId !== levelId) return null
    const previewLevelId = capturedLevelId ?? levelId
    const levelObject = previewLevelId ? sceneRegistry.nodes.get(previewLevelId) : null
    if (!levelObject) return null
    const buildingObject = buildingId ? (sceneRegistry.nodes.get(buildingId) ?? null) : null
    levelObject.updateWorldMatrix(true, false)
    buildingObject?.updateWorldMatrix(true, false)

    const livePoints =
      stage === 'collecting' && hover && !vertexDrag ? [...points, hover.point] : points
    const worldPoints = livePoints.map((point) =>
      localToPreviewFrame(levelObject, buildingObject, point),
    )
    const angleArc =
      kind === 'angle' && livePoints.length >= 3
        ? buildMeasurementAngleArcPoints(livePoints[0]!, livePoints[1]!, livePoints[2]!).map(
            (point) => localToPreviewFrame(levelObject, buildingObject, point),
          )
        : []
    const worldBase = points.map((point) => localToPreviewFrame(levelObject, buildingObject, point))
    const polygon = kind === 'area' || kind === 'perimeter' || kind === 'volume'
    const midpointHandles =
      polygon && stage === 'collecting' && !vertexDrag
        ? measurementPolygonMidpoints(points).map(({ edgeIndex, point }) => ({
            edgeIndex,
            position: localToPreviewFrame(levelObject, buildingObject, point),
          }))
        : []
    const activeEdges: Array<[Vector3, Vector3]> = vertexDrag
      ? measurementVertexSnapAnchors(points, vertexDrag.index, polygon).map((neighbor) => [
          localToPreviewFrame(levelObject, buildingObject, neighbor),
          worldBase[vertexDrag.index]!,
        ])
      : []
    const closedBase = worldBase.length >= 3 ? [...worldBase, worldBase[0]!] : worldBase
    const normal = baseNormal ? new Vector3(...baseNormal) : null
    const topPoints =
      normal && stage !== 'collecting'
        ? points.map((point) =>
            localToPreviewFrame(levelObject, buildingObject, [
              point[0] + normal.x * extrusionHeight,
              point[1] + normal.y * extrusionHeight,
              point[2] + normal.z * extrusionHeight,
            ]),
          )
        : []
    const closedTop = topPoints.length >= 3 ? [...topPoints, topPoints[0]!] : topPoints
    const verticals = worldBase.map((point, index) => [point, topPoints[index]!] as const)
    const guide = axisGuide
      ? {
          ...axisGuide,
          fromWorld: localToPreviewFrame(levelObject, buildingObject, axisGuide.from),
          toWorld: localToPreviewFrame(levelObject, buildingObject, axisGuide.to),
        }
      : null
    const guideAnchor =
      vertexDrag && axisGuide
        ? axisGuide.from
        : (points.at(-1) ?? (hoverOwner === '3d' ? hover?.point : undefined))
    let axisSurfaceIntersections: Array<{
      axis: MeasurementAxis
      normal: Vector3
      position: Vector3
    }> = []
    if (guideAnchor) {
      const cacheKey = `${previewLevelId}:${guideAnchor.join(':')}:${levelObject.matrixWorld.elements
        .map((value) => value.toFixed(5))
        .join(':')}`
      const now = performance.now()
      if (
        !axisIntersectionCache.current ||
        axisIntersectionCache.current.key !== cacheKey ||
        now - axisIntersectionCache.current.timestamp > 250
      ) {
        axisIntersectionCache.current = {
          intersections: surfaceQuery.collectAxisIntersections({
            levelObject,
            anchor: guideAnchor,
            maxDistance: AXIS_GUIDE_HALF_LENGTH,
          }),
          key: cacheKey,
          timestamp: now,
        }
      }
      axisSurfaceIntersections = axisIntersectionCache.current.intersections.map(
        ({ axis, normal: intersectionNormal, point }) => ({
          axis,
          normal: localNormalToPreviewFrame(levelObject, buildingObject, intersectionNormal),
          position: localToPreviewFrame(levelObject, buildingObject, point),
        }),
      )
    }
    const axisTriad = guideAnchor
      ? (['x', 'y', 'z'] as const).map((axis) => {
          const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
          const from: MeasurementPoint = [...guideAnchor]
          const to: MeasurementPoint = [...guideAnchor]
          from[axisIndex] -= AXIS_GUIDE_HALF_LENGTH
          to[axisIndex] += AXIS_GUIDE_HALF_LENGTH
          return {
            axis,
            fromWorld: localToPreviewFrame(levelObject, buildingObject, from),
            toWorld: localToPreviewFrame(levelObject, buildingObject, to),
          }
        })
      : []
    const reticle =
      hover && hoverOwner === '3d'
        ? {
            axisDirections: {
              x: localNormalToPreviewFrame(levelObject, buildingObject, [1, 0, 0]),
              y: localNormalToPreviewFrame(levelObject, buildingObject, [0, 1, 0]),
              z: localNormalToPreviewFrame(levelObject, buildingObject, [0, 0, 1]),
            },
            normal: localNormalToPreviewFrame(levelObject, buildingObject, hover.normal),
            position: localToPreviewFrame(levelObject, buildingObject, hover.point),
            snappedAxis: axisGuide?.snapped ? axisGuide.axis : null,
          }
        : null

    let label: { position: Vector3; text: string } | null = null
    let extrusionControlPosition: Vector3 | null = null
    if (kind === 'distance' && livePoints.length >= 2) {
      const start = livePoints[0]!
      const end = livePoints[livePoints.length - 1]!
      label = {
        position: localToPreviewFrame(levelObject, buildingObject, midpoint(start, end)),
        text: formatLinearMeasurement(measurementDistance(start, end), unit),
      }
    } else if (kind === 'angle' && livePoints.length >= 3) {
      const anglePoints = livePoints.slice(0, 3) as [
        MeasurementPoint,
        MeasurementPoint,
        MeasurementPoint,
      ]
      label = {
        position:
          angleArc[Math.floor(angleArc.length / 2)] ??
          localToPreviewFrame(levelObject, buildingObject, anglePoints[1]),
        text: formatAngleRadians(measurementAngle(...anglePoints)),
      }
    } else if ((kind === 'area' || kind === 'perimeter') && livePoints.length >= 3) {
      const center = measurementPolygonLabelAnchor(livePoints)
      if (center) {
        label = {
          position: localToPreviewFrame(levelObject, buildingObject, center),
          text:
            kind === 'area'
              ? `A ${formatAreaLabel(measurementArea(livePoints), unit)}`
              : `P ${formatLinearMeasurement(measurementPerimeter(livePoints), unit)}`,
        }
      }
    } else if (kind === 'volume' && points.length >= 3 && baseNormal) {
      const center = measurementPolygonLabelAnchor(points)
      const extrusion: MeasurementPoint = [
        baseNormal[0] * extrusionHeight,
        baseNormal[1] * extrusionHeight,
        baseNormal[2] * extrusionHeight,
      ]
      if (center) {
        if (stage === 'extruding') {
          extrusionControlPosition = localToPreviewFrame(levelObject, buildingObject, center)
        }
        if (stage !== 'extruding') {
          label = {
            position: localToPreviewFrame(levelObject, buildingObject, [
              center[0] + extrusion[0] / 2,
              center[1] + extrusion[1] / 2,
              center[2] + extrusion[2] / 2,
            ]),
            text: `V ${formatVolumeLabel(measurementPrismVolume(points, extrusion), unit)}`,
          }
        }
      }
    }

    const errorPosition = worldPoints[worldPoints.length - 1] ?? worldBase[worldBase.length - 1]
    return {
      angleArc,
      closedBase,
      closedTop,
      errorPosition,
      extrusionControlPosition,
      guide,
      axisSurfaceIntersections,
      axisTriad,
      label,
      livePoints,
      activeEdges,
      midpointHandles,
      reticle,
      verticals,
      worldBase,
      worldPoints,
    }
  }, [
    axisGuide,
    baseNormal,
    buildingId,
    capturedLevelId,
    extrusionHeight,
    hover,
    hoverOwner,
    kind,
    levelId,
    points,
    stage,
    surfaceQuery,
    unit,
    vertexDrag,
  ])

  if (!preview) return null
  const isPolygon = kind === 'area' || kind === 'perimeter' || kind === 'volume'
  const liveClosed =
    isPolygon && preview.worldPoints.length >= 3
      ? [...preview.worldPoints, preview.worldPoints[0]!]
      : preview.worldPoints
  const distanceStrokeColor =
    kind === 'distance' && axisGuide?.snapped ? GUIDE_COLORS[axisGuide.axis] : DRAFT_COLOR

  return (
    <group>
      {preview.axisTriad.map((guide) => {
        const active = axisGuide?.axis === guide.axis
        const locked = active && Boolean(axisGuide?.snapped)
        return (
          <DraftLine
            color={GUIDE_COLORS[guide.axis]}
            dashSize={locked ? 0 : 0.16}
            gapSize={locked ? 0 : 0.07}
            key={`measurement-axis-${guide.axis}`}
            lineWidth={active ? (locked ? 4 : 2.75) : 1.5}
            opacity={active ? (locked ? 1 : 0.92) : 0.48}
            points={[guide.fromWorld, guide.toWorld]}
          />
        )
      })}
      {preview.axisSurfaceIntersections.map(({ axis, normal, position }) => (
        <AxisSurfaceIntersectionMarker
          active={axisGuide?.axis === axis}
          axis={axis}
          key={`measurement-axis-surface-${axis}-${position.toArray().join(':')}`}
          locked={axisGuide?.axis === axis && Boolean(axisGuide.snapped)}
          normal={normal}
          position={position}
        />
      ))}
      {liveClosed.length >= 2 && stage === 'collecting' ? (
        <DraftLine color={distanceStrokeColor} lineWidth={2} opacity={0.95} points={liveClosed} />
      ) : null}
      {preview.angleArc.length >= 2 ? (
        <DraftLine color={DRAFT_COLOR} lineWidth={3} points={preview.angleArc} />
      ) : null}
      {stage !== 'collecting' && preview.closedBase.length >= 2 ? (
        <DraftLine color={DRAFT_COLOR} lineWidth={2} points={preview.closedBase} />
      ) : null}
      {preview.activeEdges.map(([from, to], index) => (
        <DraftLine
          color="#f8fafc"
          key={`measurement-active-edge-${index}`}
          lineWidth={3}
          opacity={0.95}
          points={[from, to]}
        />
      ))}
      {preview.closedTop.length >= 2 && Math.abs(extrusionHeight) > 0 ? (
        <DraftLine color={DRAFT_COLOR} lineWidth={2} points={preview.closedTop} />
      ) : null}
      {Math.abs(extrusionHeight) > 0
        ? preview.verticals.map(([from, to], index) => (
            <DraftLine
              color={DRAFT_COLOR}
              key={`measurement-extrusion-${index}`}
              lineWidth={1.5}
              opacity={0.75}
              points={[from, to]}
            />
          ))
        : null}
      {preview.guide ? (
        <>
          <DraftLine
            color="#f8fafc"
            lineWidth={4.5}
            opacity={preview.guide.snapped ? 0.78 : 0.38}
            points={[preview.guide.fromWorld, preview.guide.toWorld]}
          />
          <DraftLine
            color={GUIDE_COLORS[preview.guide.axis]}
            dashSize={preview.guide.snapped ? 0 : 0.08}
            gapSize={preview.guide.snapped ? 0 : 0.05}
            lineWidth={preview.guide.snapped ? 3 : 2}
            opacity={preview.guide.snapped ? 1 : 0.84}
            points={[preview.guide.fromWorld, preview.guide.toWorld]}
          />
        </>
      ) : null}
      {preview.worldBase.map((point, index) => (
        <mesh
          key={`measurement-point-${index}`}
          layers={EDITOR_LAYER}
          material={vertexDrag?.index === index ? draftActivePointMaterial : draftPointMaterial}
          position={point}
        >
          <sphereGeometry args={[vertexDrag?.index === index ? 0.045 : 0.035, 12, 12]} />
        </mesh>
      ))}
      {preview.midpointHandles.map(({ edgeIndex, position }) => (
        <mesh
          key={`measurement-midpoint-${edgeIndex}`}
          layers={EDITOR_LAYER}
          material={draftMidpointMaterial}
          position={position}
        >
          <sphereGeometry args={[0.022, 12, 12]} />
        </mesh>
      ))}
      {preview.reticle ? (
        <SurfaceReticle
          activeAxis={axisGuide?.axis ?? null}
          axisDirections={preview.reticle.axisDirections}
          normal={preview.reticle.normal}
          position={preview.reticle.position}
          snappedAxis={preview.reticle.snappedAxis}
        />
      ) : null}
      {preview.label ? (
        <DraftLabel
          appearance="outlined"
          offset={kind === 'distance'}
          position={preview.label.position}
        >
          {preview.label.text}
        </DraftLabel>
      ) : null}
      {preview.extrusionControlPosition ? (
        <DraftExtrusionControl position={preview.extrusionControlPosition} />
      ) : null}
      {error && preview.errorPosition ? (
        <DraftLabel position={preview.errorPosition} tone="error">
          {error}
        </DraftLabel>
      ) : null}
    </group>
  )
}

export const MeasurementTool: FC = () => {
  const { camera, gl, scene } = useThree()
  const currentBuildingId = useViewer((state) => state.selection.buildingId)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const storedKind = useEditor((state) => state.toolDefaults.measurement?.kind)
  const kind = isMeasurementKind(storedKind) ? storedKind : 'distance'
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const vertexGesture = useRef<{
    pointerId: number
    source: 'vertex' | 'midpoint'
    index: number
    startX: number
    startY: number
    engaged: boolean
    previousInputDragging: boolean
    previousCursor: string
  } | null>(null)
  const suppressNextClick = useRef(false)
  const cancelVertexGesture = useRef<() => void>(() => {})
  const surfaceQuery = useMemo(() => createMeasurementSurfaceQuerySession(scene), [scene])

  useEffect(() => {
    raycaster.current.layers.set(SCENE_LAYER)
  }, [])

  useEffect(() => () => surfaceQuery.dispose(), [surfaceQuery])

  useEffect(() => {
    cancelVertexGesture.current()
    useMeasurementDraft.getState().setKind(kind)
  }, [kind])

  useEffect(() => {
    const draft = useMeasurementDraft.getState()
    if (draft.levelId && draft.levelId !== currentLevelId) {
      cancelVertexGesture.current()
      draft.reset()
    }
  }, [currentLevelId])

  useEffect(() => {
    useViewer.getState().setSelection({ selectedIds: [] })
    const scope = useInteractionScope.getState()
    scope.begin({ kind: 'drafting', tool: 'measurement' })
    return () => {
      useMeasurementDraft.getState().reset()
      useInteractionScope
        .getState()
        .endIf((active) => active.kind === 'drafting' && active.tool === 'measurement')
    }
  }, [])

  useEffect(() => {
    const onCancel = () => {
      const draft = useMeasurementDraft.getState()
      const owner = draft.owner
      if (!owner) return
      markToolCancelConsumed()
      cancelVertexGesture.current()
      const preferredNormal: MeasurementPoint | undefined = owner === '2d' ? [0, 1, 0] : undefined
      if (!finishMeasurementDraft(owner, preferredNormal)) {
        useMeasurementDraft.getState().reset()
      }
    }
    emitter.on('tool:cancel', onCancel)
    return () => emitter.off('tool:cancel', onCancel)
  }, [])

  useEffect(() => {
    const canvas = gl.domElement
    let planarProximityAnchors: AlignmentAnchor[] = []
    let planarProximityAnchorsTimestamp = Number.NEGATIVE_INFINITY

    const getPlanarProximityAnchors = () => {
      const now = performance.now()
      if (now - planarProximityAnchorsTimestamp > 120) {
        planarProximityAnchors = collectAlignmentAnchors(
          useScene.getState().nodes,
          '',
          currentLevelId,
        )
        planarProximityAnchorsTimestamp = now
      }
      return planarProximityAnchors
    }

    const getLevelObject = () =>
      currentLevelId ? (sceneRegistry.nodes.get(currentLevelId) ?? null) : null

    const consume = (event: MouseEvent | PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const closestVertexIndex = (
      event: MouseEvent | PointerEvent,
      levelObject: Object3D,
      points: readonly MeasurementPoint[],
      threshold = VERTEX_HANDLE_DISTANCE_PX,
    ) =>
      selectClosestMeasurementVertexIndex(
        points.map((point) =>
          worldPointScreenDistance(
            levelObject.localToWorld(new Vector3(...point)),
            event,
            camera,
            canvas,
          ),
        ),
        threshold,
      )

    const clearVertexGesture = (finish: boolean) => {
      const gesture = vertexGesture.current
      if (!gesture) return
      if (gesture.engaged) {
        const draft = useMeasurementDraft.getState()
        if (finish) draft.finishVertexDrag('3d')
        else draft.cancelVertexDrag('3d')
        useViewer.getState().setInputDragging(gesture.previousInputDragging)
      }
      document.body.style.cursor = gesture.previousCursor
      if (canvas.hasPointerCapture?.(gesture.pointerId)) {
        canvas.releasePointerCapture(gesture.pointerId)
      }
      vertexGesture.current = null
    }
    cancelVertexGesture.current = () => clearVertexGesture(false)

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || useViewer.getState().cameraDragging) return
      const draft = useMeasurementDraft.getState()
      if (draft.owner !== '3d' || draft.stage !== 'collecting' || draft.vertexDrag) return
      if (draft.kind === 'distance') return
      const levelObject = getLevelObject()
      if (!levelObject) return
      const threshold = event.pointerType === 'touch' ? 22 : VERTEX_HANDLE_DISTANCE_PX
      const vertexIndex = closestVertexIndex(event, levelObject, draft.points, threshold)
      const midpointIndex =
        vertexIndex === null
          ? closestVertexIndex(
              event,
              levelObject,
              measurementPolygonMidpoints(draft.points).map((midpoint) => midpoint.point),
              event.pointerType === 'touch' ? 18 : MIDPOINT_HANDLE_DISTANCE_PX,
            )
          : null
      if (vertexIndex === null && midpointIndex === null) return
      consume(event)
      canvas.setPointerCapture?.(event.pointerId)
      vertexGesture.current = {
        pointerId: event.pointerId,
        source: vertexIndex !== null ? 'vertex' : 'midpoint',
        index: vertexIndex ?? midpointIndex!,
        startX: event.clientX,
        startY: event.clientY,
        engaged: false,
        previousInputDragging: useViewer.getState().inputDragging,
        previousCursor: document.body.style.cursor,
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const draft = useMeasurementDraft.getState()
      if (draft.owner && draft.owner !== '3d') return
      const levelObject = getLevelObject()
      if (!levelObject) return

      const gesture = vertexGesture.current
      if (gesture?.pointerId === event.pointerId) {
        consume(event)
        if (!gesture.engaged) {
          if (
            Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <
            VERTEX_DRAG_ACTIVATION_PX
          ) {
            return
          }
          const began =
            gesture.source === 'vertex'
              ? draft.beginVertexDrag('3d', gesture.index)
              : draft.beginMidpointVertexDrag('3d', gesture.index)
          if (!began) {
            clearVertexGesture(false)
            return
          }
          if (gesture.source === 'midpoint') gesture.index += 1
          gesture.engaged = true
          useViewer.getState().setInputDragging(true)
          document.body.style.cursor = 'grabbing'
        }

        const activeDraft = useMeasurementDraft.getState()
        const anchors = measurementVertexSnapAnchors(
          activeDraft.points,
          gesture.index,
          activeDraft.kind === 'area' ||
            activeDraft.kind === 'perimeter' ||
            activeDraft.kind === 'volume',
        )
        const applyMagneticSnap = !event.altKey
        const resolved = surfaceQuery.resolvePointer({
          event,
          camera,
          canvas,
          levelObject,
          anchorOrAnchors: anchors,
          lockedGuide:
            applyMagneticSnap && activeDraft.axisGuide?.snapped ? activeDraft.axisGuide : null,
          planarProximityAnchors: getPlanarProximityAnchors(),
          applyMagneticSnap,
          showAlignmentGuides: isAlignmentGuideActive(),
        })
        if (resolved) {
          const hit = associateSurfaceHit(
            resolved.hit,
            applyMagneticSnap ? SEMANTIC_FEATURE_SNAP_DISTANCE : SURFACE_VERIFY_TOLERANCE,
          )
          activeDraft.updateDraggedVertex(
            '3d',
            {
              point: hit.point,
              normal: hit.normal,
              targetNodeId: hit.targetNodeId,
              anchor: hit.anchor,
              semantic: hit.semantic,
            },
            resolved.guide,
          )
        }
        return
      }

      if (draft.owner === '3d' && draft.stage === 'extruding' && draft.baseNormal) {
        const height = extrusionHeightFromPointer(
          event,
          camera,
          canvas,
          raycaster.current,
          pointer.current,
          levelObject,
          draft.points,
          draft.baseNormal,
        )
        if (height !== null) draft.setExtrusionHeight('3d', height)
        return
      }

      if (draft.stage !== 'collecting') return
      const applyMagneticSnap = !event.altKey
      const resolved = surfaceQuery.resolvePointer({
        event,
        camera,
        canvas,
        levelObject,
        anchorOrAnchors: draft.points[draft.points.length - 1] ?? null,
        lockedGuide: applyMagneticSnap && draft.axisGuide?.snapped ? draft.axisGuide : null,
        planarProximityAnchors: getPlanarProximityAnchors(),
        applyMagneticSnap,
        showAlignmentGuides: isAlignmentGuideActive(),
      })
      draft.setHover(
        '3d',
        resolved
          ? associateSurfaceHit(
              resolved.hit,
              applyMagneticSnap ? SEMANTIC_FEATURE_SNAP_DISTANCE : SURFACE_VERIFY_TOLERANCE,
            )
          : null,
        resolved?.guide ?? null,
      )
    }

    const onPointerLeave = () => {
      if (vertexGesture.current) return
      const draft = useMeasurementDraft.getState()
      if (draft.stage !== 'collecting') return
      if (!draft.owner || draft.owner === '3d') draft.setHover('3d', null)
    }

    const onPointerUp = (event: PointerEvent) => {
      const gesture = vertexGesture.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      consume(event)
      const wasEngaged = gesture.engaged
      const source = gesture.source
      const vertexIndex = gesture.index
      clearVertexGesture(true)
      if (!wasEngaged && source === 'vertex') {
        const draft = useMeasurementDraft.getState()
        if (vertexIndex === 0 && draft.points.length >= 3) finishMeasurementDraft('3d')
      }
      suppressNextClick.current = true
      setTimeout(() => {
        suppressNextClick.current = false
      }, 300)
    }

    const onPointerCancel = (event: PointerEvent) => {
      const gesture = vertexGesture.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      consume(event)
      clearVertexGesture(false)
    }

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || useViewer.getState().cameraDragging) return
      const draft = useMeasurementDraft.getState()
      if (draft.owner && draft.owner !== '3d') return
      consume(event)
      if (suppressNextClick.current) {
        suppressNextClick.current = false
        return
      }
      if (event.detail > 1) return

      if (draft.owner === '3d' && draft.stage === 'extruding') {
        finishMeasurementDraft('3d')
        return
      }
      if (draft.stage !== 'collecting') return

      const levelObject = getLevelObject()
      if (!levelObject) return
      const vertexIndex =
        draft.kind === 'distance' ? null : closestVertexIndex(event, levelObject, draft.points)
      if (vertexIndex !== null) {
        if (vertexIndex === 0 && draft.points.length >= 3 && draft.kind !== 'angle') {
          finishMeasurementDraft('3d')
        }
        return
      }
      const applyMagneticSnap = !event.altKey
      const resolved = surfaceQuery.resolvePointer({
        event,
        camera,
        canvas,
        levelObject,
        anchorOrAnchors: draft.points[draft.points.length - 1] ?? null,
        lockedGuide: applyMagneticSnap && draft.axisGuide?.snapped ? draft.axisGuide : null,
        planarProximityAnchors: getPlanarProximityAnchors(),
        applyMagneticSnap,
        showAlignmentGuides: isAlignmentGuideActive(),
      })
      if (!resolved) return
      const hit = associateSurfaceHit(
        resolved.hit,
        applyMagneticSnap ? SEMANTIC_FEATURE_SNAP_DISTANCE : SURFACE_VERIFY_TOLERANCE,
      )
      if (!draft.addPoint('3d', hit.point, hit.anchor)) return
      if (useMeasurementDraft.getState().stage === 'ready') commitMeasurementDraft('3d')
    }

    const onDoubleClick = (event: MouseEvent) => {
      const draft = useMeasurementDraft.getState()
      if (draft.owner !== '3d' || draft.stage !== 'collecting') return
      if (draft.kind === 'distance' || draft.kind === 'angle') return
      consume(event)
      if (suppressNextClick.current) {
        suppressNextClick.current = false
        return
      }
      finishMeasurementDraft('3d')
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardTarget(event.target)) return
      const draft = useMeasurementDraft.getState()
      if (!draft.owner) return

      if (event.key === 'Backspace') {
        event.preventDefault()
        event.stopImmediatePropagation()
        draft.removeLast(draft.owner)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        finishMeasurementDraft(draft.owner, draft.owner === '2d' ? [0, 1, 0] : undefined)
      }
    }

    const onBlur = () => clearVertexGesture(false)

    canvas.addEventListener('pointerdown', onPointerDown, true)
    canvas.addEventListener('pointermove', onPointerMove, true)
    canvas.addEventListener('pointerup', onPointerUp, true)
    canvas.addEventListener('pointercancel', onPointerCancel, true)
    canvas.addEventListener('pointerleave', onPointerLeave, true)
    canvas.addEventListener('click', onClick, true)
    canvas.addEventListener('dblclick', onDoubleClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      cancelVertexGesture.current = () => {}
      clearVertexGesture(false)
      canvas.removeEventListener('pointerdown', onPointerDown, true)
      canvas.removeEventListener('pointermove', onPointerMove, true)
      canvas.removeEventListener('pointerup', onPointerUp, true)
      canvas.removeEventListener('pointercancel', onPointerCancel, true)
      canvas.removeEventListener('pointerleave', onPointerLeave, true)
      canvas.removeEventListener('click', onClick, true)
      canvas.removeEventListener('dblclick', onDoubleClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [camera, currentLevelId, gl, surfaceQuery])

  return (
    <MeasurementDraftPreview
      buildingId={currentBuildingId}
      levelId={currentLevelId}
      surfaceQuery={surfaceQuery}
    />
  )
}

export default MeasurementTool
