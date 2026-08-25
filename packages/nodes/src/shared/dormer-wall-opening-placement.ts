import {
  type AnyNode,
  type DormerEvent,
  type DormerNode,
  dormerPointToWallFace,
  getDormerWallFaceFrame,
  getDormerWallOpeningVerticalBounds,
  type WindowEvent,
  type WindowNode,
} from '@pascal-app/core'
import { type Object3D, Vector3 } from 'three'

export type DormerWindowTarget = {
  dormer: DormerNode
  face: NonNullable<WindowNode['dormerFace']>
  position: [number, number, number]
  valid: boolean
}

const dormerFaceNormal = new Vector3()

export function dormerEventFromHostedWindow(
  event: WindowEvent,
  dormer: DormerNode,
  object: Object3D,
): DormerEvent {
  object.updateWorldMatrix(true, false)
  const localPoint = object.worldToLocal(new Vector3(...event.position))
  const face = event.node.dormerFace ?? 'front'
  const normal: [number, number, number] =
    face === 'front'
      ? [0, 0, 1]
      : face === 'back'
        ? [0, 0, -1]
        : face === 'right'
          ? [1, 0, 0]
          : [-1, 0, 0]

  return {
    node: dormer,
    normal,
    object,
    position: event.position,
    localPosition: [localPoint.x, localPoint.y, localPoint.z],
    faceIndex: event.faceIndex,
    nativeEvent: event.nativeEvent,
    stopPropagation: event.stopPropagation,
  }
}

export function getDormerWindowWorldYaw(event: DormerEvent, target: DormerWindowTarget): number {
  const frame = getDormerWallFaceFrame(event.node, target.face)
  event.object.updateWorldMatrix(true, false)
  dormerFaceNormal
    .set(Math.sin(frame.yaw), 0, Math.cos(frame.yaw))
    .transformDirection(event.object.matrixWorld)
  return Math.atan2(dormerFaceNormal.x, dormerFaceNormal.z)
}

export function shouldWriteDormerWindowPreviewHost(
  node: WindowNode,
  target: DormerWindowTarget,
): boolean {
  return (
    node.parentId !== target.dormer.id ||
    node.dormerId !== target.dormer.id ||
    node.dormerFace !== target.face ||
    node.wallId !== undefined ||
    node.roofSegmentId !== undefined ||
    node.roofFace !== undefined ||
    node.visible !== false
  )
}

function faceFromNormal(normal: DormerEvent['normal']): DormerWindowTarget['face'] | null {
  if (!normal) return null
  const [x, , z] = normal
  if (Math.abs(z) >= Math.abs(x)) return z >= 0 ? 'front' : 'back'
  return x >= 0 ? 'right' : 'left'
}

function faceFromPoint(
  dormer: DormerNode,
  point: [number, number, number],
): DormerWindowTarget['face'] {
  const distances = [
    { face: 'front' as const, distance: Math.abs(point[2] - dormer.depth / 2) },
    { face: 'back' as const, distance: Math.abs(point[2] + dormer.depth / 2) },
    { face: 'right' as const, distance: Math.abs(point[0] - dormer.width / 2) },
    { face: 'left' as const, distance: Math.abs(point[0] + dormer.width / 2) },
  ]
  return distances.reduce((closest, current) =>
    current.distance < closest.distance ? current : closest,
  ).face
}

function hasWindowOverlap(
  dormer: DormerNode,
  nodes: Readonly<Record<string, AnyNode>>,
  face: DormerWindowTarget['face'],
  position: [number, number, number],
  width: number,
  height: number,
  ignoreId?: string,
): boolean {
  const left = position[0] - width / 2
  const right = position[0] + width / 2
  const bottom = position[1] - height / 2
  const top = position[1] + height / 2

  return (dormer.children ?? []).some((childId) => {
    if (childId === ignoreId) return false
    const child = nodes[childId]
    if (child?.type !== 'window' || child.dormerFace !== face) return false
    return (
      Math.abs(child.position[0] - position[0]) < (child.width + width) / 2 &&
      Math.abs(child.position[1] - position[1]) < (child.height + height) / 2 &&
      child.position[0] + child.width / 2 > left &&
      child.position[0] - child.width / 2 < right &&
      child.position[1] + child.height / 2 > bottom &&
      child.position[1] - child.height / 2 < top
    )
  })
}

export function resolveDormerWindowTarget(args: {
  event: DormerEvent
  width: number
  height: number
  nodes: Readonly<Record<string, AnyNode>>
  ignoreId?: string
  snap?: (value: number) => number
}): DormerWindowTarget | null {
  const { event, width, height, nodes, ignoreId, snap = (value) => value } = args
  const face = faceFromNormal(event.normal) ?? faceFromPoint(event.node, event.localPosition)

  const point = dormerPointToWallFace(event.node, face, event.localPosition)
  const frame = getDormerWallFaceFrame(event.node, face)
  const clampedX = Math.max(
    -frame.width / 2 + width / 2,
    Math.min(frame.width / 2 - width / 2, snap(point[0])),
  )
  const vertical = getDormerWallOpeningVerticalBounds(event.node, face, clampedX, width)
  const minY = vertical.min + height / 2
  const maxY = vertical.max - height / 2
  if (maxY < minY) return null
  const clampedY = Math.max(minY, Math.min(maxY, snap(point[1])))
  const position: [number, number, number] = [clampedX, clampedY, 0]

  return {
    dormer: event.node,
    face,
    position,
    valid: !hasWindowOverlap(event.node, nodes, face, position, width, height, ignoreId),
  }
}
