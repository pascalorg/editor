'use client'

import {
  type AnyNode,
  type LiveNodeOverrides,
  type LiveTransform,
  nodeRegistry,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useLayoutEffect, useMemo, useState } from 'react'
import { Box3, BufferGeometry, type Matrix4, type Object3D, Vector3 } from 'three'
import {
  type MeasurementPoint,
  type MeasurementPointAttachment,
  type MeasurementSegment,
  useMeasurementTool,
} from '../store/use-measurement-tool'
import { EDITOR_LAYER } from './constants'
import { collectNodePlanMeasurementSnapGeometry } from './measurement-snapping'

const EMPTY_LIVE_TRANSFORMS = new Map<string, LiveTransform>()
const EMPTY_LIVE_OVERRIDES = new Map<string, LiveNodeOverrides>()

function applyLiveTransform(node: AnyNode, live: LiveTransform | undefined): AnyNode {
  if (!live) return node

  const parentFrameProjection = nodeRegistry.get(node.type)?.capabilities?.movable?.parentFrame
    ?.floorplanLiveTransform
  if (parentFrameProjection) return parentFrameProjection({ node, live })

  const measurementProjection = nodeRegistry.get(node.type)?.measurement?.applyLiveTransform
  if (measurementProjection) return measurementProjection(node as never, live)

  if (!Array.isArray((node as { position?: unknown }).position)) return node
  const currentRotation = (node as { rotation?: unknown }).rotation
  const rotation = Array.isArray(currentRotation)
    ? [currentRotation[0] ?? 0, live.rotation, currentRotation[2] ?? 0]
    : typeof currentRotation === 'number'
      ? live.rotation
      : currentRotation

  return {
    ...node,
    position: live.position,
    ...(rotation !== undefined ? { rotation } : {}),
    parentId: null,
  } as AnyNode
}

function effectiveMeasurementNodes(
  nodes: Readonly<Record<string, AnyNode>>,
  liveTransforms: ReadonlyMap<string, LiveTransform>,
  liveOverrides: ReadonlyMap<string, LiveNodeOverrides>,
): Record<string, AnyNode> {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => {
      const override = liveOverrides.get(id)
      const overridden = override ? ({ ...node, ...override } as AnyNode) : node
      return [id, applyLiveTransform(overridden, liveTransforms.get(id))]
    }),
  )
}

function addBoxCorners(box: Box3, transform: Matrix4, target: Box3) {
  const { min, max } = box
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z])
        target.expandByPoint(new Vector3(x, y, z).applyMatrix4(transform))
    }
  }
}

const EDITOR_OVERLAY_RENDER_ORDER = 1000
const EDITOR_LAYER_MASK = 1 << EDITOR_LAYER

function isEditorOverlayObject(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if ((current.layers.mask & EDITOR_LAYER_MASK) !== 0) return true
    if (current.renderOrder >= EDITOR_OVERLAY_RENDER_ORDER) return true
    if (current.userData.measurementBoundsIgnore === true) return true
    current = current.parent
  }
  return false
}

function nodeLocalBounds(root: Object3D): Box3 | null {
  root.updateWorldMatrix(true, true)
  const rootInverse = root.matrixWorld.clone().invert()
  const bounds = new Box3()
  root.traverse((object) => {
    if (isEditorOverlayObject(object)) return
    const geometry = (object as { geometry?: unknown }).geometry
    if (!(geometry instanceof BufferGeometry)) return
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    if (!geometry.boundingBox) return
    addBoxCorners(geometry.boundingBox, rootInverse.clone().multiply(object.matrixWorld), bounds)
  })
  return bounds.isEmpty() ? null : bounds
}

function worldPointFromMeasurementPoint(
  point: MeasurementPoint,
  buildingId: string | undefined,
): Vector3 {
  const world = new Vector3(...point)
  const building = buildingId ? sceneRegistry.nodes.get(buildingId as never) : null
  return building ? building.localToWorld(world) : world
}

function measurementPointFromWorldPoint(
  point: Vector3,
  buildingId: string | undefined,
): MeasurementPoint {
  const building = buildingId ? sceneRegistry.nodes.get(buildingId as never) : null
  const local = building ? building.worldToLocal(point) : point
  return [local.x, local.y, local.z]
}

export function createNodeBoundsAttachment(
  nodeId: string,
  point: MeasurementPoint,
  buildingId?: string,
): MeasurementPointAttachment | undefined {
  const root = sceneRegistry.nodes.get(nodeId as never)
  if (!root) return undefined
  const bounds = nodeLocalBounds(root)
  if (!bounds) return undefined

  const local = root.worldToLocal(worldPointFromMeasurementPoint(point, buildingId))
  const size = bounds.getSize(new Vector3())
  const normalized: MeasurementPoint = [
    size.x > 1e-8 ? (local.x - bounds.min.x) / size.x : 0.5,
    size.y > 1e-8 ? (local.y - bounds.min.y) / size.y : 0.5,
    size.z > 1e-8 ? (local.z - bounds.min.z) / size.z : 0.5,
  ]

  return {
    buildingId,
    feature: { kind: 'node-bounds', normalized },
    nodeId,
  }
}

export function createPlanMeasurementAttachment(
  nodeId: string,
  point: MeasurementPoint,
  nodes: Readonly<Record<string, AnyNode>> = useScene.getState().nodes,
): MeasurementPointAttachment | undefined {
  const node = nodes[nodeId]
  if (!node) return undefined
  const geometry = collectNodePlanMeasurementSnapGeometry(node, nodes)
  let best: { attachment: MeasurementPointAttachment; distanceSq: number } | undefined

  for (const [index, anchor] of geometry.anchors.entries()) {
    const distanceSq =
      (point[0] - anchor.point[0]) ** 2 +
      (point[1] - anchor.point[1]) ** 2 +
      (point[2] - anchor.point[2]) ** 2
    if (!best || distanceSq < best.distanceSq) {
      best = {
        attachment: { feature: { index, kind: 'plan-anchor' }, nodeId },
        distanceSq,
      }
    }
  }

  for (const [index, segment] of geometry.segments.entries()) {
    const dx = segment.end[0] - segment.start[0]
    const dy = segment.end[1] - segment.start[1]
    const dz = segment.end[2] - segment.start[2]
    const lengthSq = dx * dx + dy * dy + dz * dz
    if (lengthSq < 1e-8) continue
    const t = Math.min(
      1,
      Math.max(
        0,
        ((point[0] - segment.start[0]) * dx +
          (point[1] - segment.start[1]) * dy +
          (point[2] - segment.start[2]) * dz) /
          lengthSq,
      ),
    )
    const projected: MeasurementPoint = [
      segment.start[0] + dx * t,
      segment.start[1] + dy * t,
      segment.start[2] + dz * t,
    ]
    const distanceSq =
      (point[0] - projected[0]) ** 2 +
      (point[1] - projected[1]) ** 2 +
      (point[2] - projected[2]) ** 2
    if (!best || distanceSq < best.distanceSq) {
      best = {
        attachment: { feature: { index, kind: 'plan-segment', t }, nodeId },
        distanceSq,
      }
    }
  }

  return best && best.distanceSq <= 1e-6 ? best.attachment : undefined
}

function resolveNodeBoundsAttachment(
  attachment: MeasurementPointAttachment,
): MeasurementPoint | null {
  if (attachment.feature.kind !== 'node-bounds') return null
  const root = sceneRegistry.nodes.get(attachment.nodeId as never)
  if (!root) return null
  const bounds = nodeLocalBounds(root)
  if (!bounds) return null
  const [x, y, z] = attachment.feature.normalized
  const local = new Vector3(
    bounds.min.x + (bounds.max.x - bounds.min.x) * x,
    bounds.min.y + (bounds.max.y - bounds.min.y) * y,
    bounds.min.z + (bounds.max.z - bounds.min.z) * z,
  )
  return measurementPointFromWorldPoint(root.localToWorld(local), attachment.buildingId)
}

export function resolveMeasurementAttachmentPoint(
  attachment: MeasurementPointAttachment | undefined,
  fallback: MeasurementPoint,
  nodes: Readonly<Record<string, AnyNode>>,
): MeasurementPoint {
  if (!attachment || !nodes[attachment.nodeId]) return fallback
  if (attachment.feature.kind === 'node-bounds') {
    return resolveNodeBoundsAttachment(attachment) ?? fallback
  }

  const node = nodes[attachment.nodeId]
  if (!node) return fallback
  const geometry = collectNodePlanMeasurementSnapGeometry(node, nodes)
  if (attachment.feature.kind === 'plan-anchor') {
    return geometry.anchors[attachment.feature.index]?.point ?? fallback
  }

  const segment = geometry.segments[attachment.feature.index]
  if (!segment) return fallback
  const t = attachment.feature.t
  return [
    segment.start[0] + (segment.end[0] - segment.start[0]) * t,
    segment.start[1] + (segment.end[1] - segment.start[1]) * t,
    segment.start[2] + (segment.end[2] - segment.start[2]) * t,
  ]
}

export function resolveAttachedMeasurementSegments(
  segments: ReadonlyArray<MeasurementSegment>,
  nodes: Readonly<Record<string, AnyNode>>,
  liveTransforms: ReadonlyMap<string, LiveTransform> = EMPTY_LIVE_TRANSFORMS,
  liveOverrides: ReadonlyMap<string, LiveNodeOverrides> = EMPTY_LIVE_OVERRIDES,
): MeasurementSegment[] {
  const effectiveNodes = effectiveMeasurementNodes(nodes, liveTransforms, liveOverrides)
  return segments.map((segment) => {
    const start = resolveMeasurementAttachmentPoint(
      segment.startAttachment,
      segment.start,
      effectiveNodes,
    )
    const end = resolveMeasurementAttachmentPoint(
      segment.endAttachment,
      segment.end,
      effectiveNodes,
    )
    const attachmentMoved =
      (segment.startAttachment &&
        (start[0] !== segment.start[0] ||
          start[1] !== segment.start[1] ||
          start[2] !== segment.start[2])) ||
      (segment.endAttachment &&
        (end[0] !== segment.end[0] || end[1] !== segment.end[1] || end[2] !== segment.end[2]))
    return {
      ...segment,
      start,
      end,
      measuredDistanceMeters: attachmentMoved ? undefined : segment.measuredDistanceMeters,
    }
  })
}

function sameMeasurementPoint(a: MeasurementPoint, b: MeasurementPoint) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

export function sameResolvedMeasurementSegments(
  previous: ReadonlyArray<MeasurementSegment>,
  next: ReadonlyArray<MeasurementSegment>,
) {
  return (
    previous.length === next.length &&
    next.every((segment, index) => {
      const current = previous[index]
      return (
        current?.id === segment.id &&
        sameMeasurementPoint(current.start, segment.start) &&
        sameMeasurementPoint(current.end, segment.end) &&
        current.measuredDistanceMeters === segment.measuredDistanceMeters
      )
    })
  )
}

export function refreshRenderedBoundsMeasurementSegments(
  previous: ReadonlyArray<MeasurementSegment>,
  segments: ReadonlyArray<MeasurementSegment>,
  nodes: Readonly<Record<string, AnyNode>>,
  liveTransforms: ReadonlyMap<string, LiveTransform> = EMPTY_LIVE_TRANSFORMS,
  liveOverrides: ReadonlyMap<string, LiveNodeOverrides> = EMPTY_LIVE_OVERRIDES,
): MeasurementSegment[] {
  const next = resolveAttachedMeasurementSegments(segments, nodes, liveTransforms, liveOverrides)
  return sameResolvedMeasurementSegments(previous, next) ? (previous as MeasurementSegment[]) : next
}

export function getResolvedMeasurementSegments(): MeasurementSegment[] {
  return resolveAttachedMeasurementSegments(
    useMeasurementTool.getState().segments,
    useScene.getState().nodes,
    useLiveTransforms.getState().transforms,
    useLiveNodeOverrides.getState().overrides,
  )
}

export function useResolvedMeasurementSegments(
  segments: ReadonlyArray<MeasurementSegment>,
): MeasurementSegment[] {
  const nodes = useScene((state) => state.nodes)
  const liveTransforms = useLiveTransforms((state) => state.transforms)
  const liveOverrides = useLiveNodeOverrides((state) => state.overrides)
  const resolved = useMemo(
    () => resolveAttachedMeasurementSegments(segments, nodes, liveTransforms, liveOverrides),
    [segments, nodes, liveTransforms, liveOverrides],
  )
  const hasRenderedBoundsAttachment = segments.some(
    (segment) =>
      segment.startAttachment?.feature.kind === 'node-bounds' ||
      segment.endAttachment?.feature.kind === 'node-bounds',
  )
  const [postCommitResolved, setPostCommitResolved] = useState(resolved)

  useLayoutEffect(() => {
    if (!hasRenderedBoundsAttachment) return
    setPostCommitResolved((previous) =>
      refreshRenderedBoundsMeasurementSegments(
        previous,
        segments,
        nodes,
        liveTransforms,
        liveOverrides,
      ),
    )
  }, [hasRenderedBoundsAttachment, segments, nodes, liveTransforms, liveOverrides])

  return hasRenderedBoundsAttachment ? postCommitResolved : resolved
}
