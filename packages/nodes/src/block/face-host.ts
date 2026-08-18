import {
  type BlockNode,
  type FaceHostCapability,
  getBlockFaceFrame,
  type ItemNode,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

type FaceBounds = {
  minU: number
  maxU: number
  minV: number
  maxV: number
}

type BlockFaceRange = { faceId: string; start: number; count: number }

const BLOCK_HORIZONTAL_NORMAL_MIN_Y = 0.95
const BLOCK_VERTICAL_NORMAL_MAX_Y = 0.05
const BLOCK_FLOOR_ROTATION_X = Math.PI / 2
const BLOCK_CEILING_ROTATION_X = -Math.PI / 2
const BLOCK_FACE_STICKY_PLANE_EPSILON = 0.08

function blockFaceAcceptsAttachment(
  normalY: number,
  attachTo: Parameters<FaceHostCapability['resolvePlacement']>[0]['asset']['attachTo'],
): boolean {
  if (!attachTo) return normalY >= BLOCK_HORIZONTAL_NORMAL_MIN_Y
  if (attachTo === 'ceiling') return normalY <= -BLOCK_HORIZONTAL_NORMAL_MIN_Y
  if (attachTo === 'wall' || attachTo === 'wall-side') {
    return Math.abs(normalY) <= BLOCK_VERTICAL_NORMAL_MAX_Y
  }
  return false
}

function blockHitFaceId(args: Parameters<FaceHostCapability<BlockNode>['resolvePlacement']>[0]) {
  if (args.faceIndex == null) return null
  const geometry = (args.object as { geometry?: { userData?: Record<string, unknown> } }).geometry
  const ranges = geometry?.userData?.blockFaces
  if (!Array.isArray(ranges)) return null
  const triangleStart = args.faceIndex * 3
  const range = (ranges as BlockFaceRange[]).find(
    (candidate) =>
      triangleStart >= candidate.start && triangleStart < candidate.start + candidate.count,
  )
  return range?.faceId ?? null
}

function clampBlockFacePosition(
  position: readonly [number, number, number],
  bounds: FaceBounds,
  dimensions: readonly [width: number, height: number],
): [number, number, number] | null {
  const [width, height] = dimensions
  const minU = bounds.minU + width / 2
  const maxU = bounds.maxU - width / 2
  const minV = bounds.minV
  const maxV = bounds.maxV - height
  if (minU > maxU || minV > maxV) return null
  return [
    Math.min(maxU, Math.max(minU, position[0])),
    Math.min(maxV, Math.max(minV, position[1])),
    position[2],
  ]
}

function clampBlockFaceCenterPosition(
  position: readonly [number, number, number],
  bounds: FaceBounds,
  dimensions: readonly [width: number, depth: number],
): [number, number, number] | null {
  const [width, depth] = dimensions
  const minU = bounds.minU + width / 2
  const maxU = bounds.maxU - width / 2
  const minV = bounds.minV + depth / 2
  const maxV = bounds.maxV - depth / 2
  if (minU > maxU || minV > maxV) return null
  return [
    Math.min(maxU, Math.max(minU, position[0])),
    Math.min(maxV, Math.max(minV, position[1])),
    position[2],
  ]
}

function resolveBlockFaceTargetForFace(
  args: Parameters<FaceHostCapability<BlockNode>['resolvePlacement']>[0],
  faceId: string,
  options: { requirePointerOnPlane?: boolean } = {},
) {
  const attachTo = args.asset.attachTo
  const frame = getBlockFaceFrame(args.host.topology, faceId)
  if (!frame) return null
  if (!blockFaceAcceptsAttachment(frame.normal[1], attachTo)) return null

  const hit = new Vector3(...args.localPosition).sub(new Vector3(...frame.origin))
  const xAxis = new Vector3(...frame.xAxis)
  const yAxis = new Vector3(...frame.yAxis)
  const normal = new Vector3(...frame.normal)
  if (
    options.requirePointerOnPlane &&
    Math.abs(hit.dot(normal)) > BLOCK_FACE_STICKY_PLANE_EPSILON
  ) {
    return null
  }

  const face = args.host.topology.faces.find((candidate) => candidate.id === faceId)
  if (!face) return null
  const vertices = new Map(
    args.host.topology.vertices.map((vertex) => [vertex.id, vertex.position]),
  )
  let minU = Number.POSITIVE_INFINITY
  let maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY
  let maxV = Number.NEGATIVE_INFINITY
  for (const vertexId of face.vertexIds) {
    const point = vertices.get(vertexId)
    if (!point) return null
    const dx = point[0] - frame.origin[0]
    const dy = point[1] - frame.origin[1]
    const dz = point[2] - frame.origin[2]
    const pointU = dx * xAxis.x + dy * xAxis.y + dz * xAxis.z
    const pointV = dx * yAxis.x + dy * yAxis.y + dz * yAxis.z
    minU = Math.min(minU, pointU)
    maxU = Math.max(maxU, pointU)
    minV = Math.min(minV, pointV)
    maxV = Math.max(maxV, pointV)
  }

  const [width, height, depth] = args.dimensions
  const snappedPosition: [number, number, number] = [
    args.snapScalar(hit.dot(xAxis)),
    args.snapScalar(hit.dot(yAxis)),
    0,
  ]
  const faceBounds = { minU, maxU, minV, maxV }
  const facePosition =
    !attachTo || attachTo === 'ceiling'
      ? clampBlockFaceCenterPosition(snappedPosition, faceBounds, [width, depth])
      : clampBlockFacePosition(snappedPosition, faceBounds, [width, height])
  if (!facePosition) return null

  const [u, v] = facePosition
  const normalOffset = attachTo === 'ceiling' && !args.asset.recessed ? args.rawDimensions[1] : 0
  const position: [number, number, number] = [u, v, normalOffset]
  const localPoint = new Vector3(...frame.origin)
    .addScaledVector(xAxis, u)
    .addScaledVector(yAxis, v)
    .addScaledVector(normal, normalOffset)
  args.object.updateWorldMatrix(true, false)
  const worldPoint = args.object.localToWorld(localPoint)

  const localFrame = new Matrix4().makeBasis(xAxis, yAxis, normal)
  const worldFrame = new Matrix4().copy(args.object.matrixWorld).multiply(localFrame)
  const worldQuaternion = new Quaternion()
  worldFrame.decompose(new Vector3(), worldQuaternion, new Vector3())
  const rotation: [number, number, number] = !attachTo
    ? [BLOCK_FLOOR_ROTATION_X, 0, 0]
    : attachTo === 'ceiling'
      ? [BLOCK_CEILING_ROTATION_X, 0, 0]
      : [0, 0, 0]
  worldQuaternion.multiply(new Quaternion().setFromEuler(new Euler(...rotation)))
  const cursorRotation = new Euler().setFromQuaternion(worldQuaternion, 'XYZ')

  return {
    faceId,
    nodeUpdate: {
      position,
      parentId: args.host.id,
      blockFaceId: faceId,
      roofSegmentId: undefined,
      roofFace: undefined,
      wallId: undefined,
      side: 'front',
      rotation,
    } satisfies Partial<ItemNode>,
    position,
    rotation,
    cursorPosition: worldPoint.toArray() as [number, number, number],
    cursorRotation: [cursorRotation.x, cursorRotation.y, cursorRotation.z] as [
      number,
      number,
      number,
    ],
  }
}

export const blockFaceHost: FaceHostCapability<BlockNode> = {
  currentFaceId: (item: ItemNode | null) => item?.blockFaceId ?? null,
  clearItemFields: ['position', 'rotation', 'blockFaceId'],
  resolvePlacement: (args) => {
    if (args.currentFaceId) {
      const currentTarget = resolveBlockFaceTargetForFace(args, args.currentFaceId, {
        requirePointerOnPlane: true,
      })
      if (currentTarget) return currentTarget
    }
    const faceId = blockHitFaceId(args)
    return faceId ? resolveBlockFaceTargetForFace(args, faceId) : null
  },
  storedPlacementPatch: ({ host, item, position }) => {
    if (!item.blockFaceId) return null
    return {
      position: [position[0], position[1], position[2]],
      parentId: host.id,
      blockFaceId: item.blockFaceId,
      roofSegmentId: undefined,
      roofFace: undefined,
      wallId: undefined,
      side: 'front',
      rotation: item.rotation,
    }
  },
  isStoredPlacementValid: ({ host, item, asset }) => {
    if (!item.blockFaceId) return false
    const frame = getBlockFaceFrame(host.topology, item.blockFaceId)
    return !!(frame && blockFaceAcceptsAttachment(frame.normal[1], asset.attachTo))
  },
}
