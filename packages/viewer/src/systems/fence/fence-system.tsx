import { useFrame } from '@react-three/fiber'
import {
  type AnyNodeId,
  type FenceNode,
  getWallCurveFrameAt,
  getWallCurveLength,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type FencePart = {
  position: [number, number, number]
  rotationY?: number
  scale: [number, number, number]
}

const MIN_CURVE_SEGMENT_LENGTH = 0.18

function createFencePartGeometry(part: FencePart) {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.scale(part.scale[0], part.scale[1], part.scale[2])
  if (part.rotationY) {
    geometry.rotateY(part.rotationY)
  }
  geometry.translate(part.position[0], part.position[1], part.position[2])
  applyFenceUVs(geometry)
  return geometry
}

function getFencePointAt(fence: FenceNode, t: number) {
  const frame = getWallCurveFrameAt(fence, t)
  return {
    point: frame.point,
    tangentAngle: Math.atan2(frame.tangent.y, frame.tangent.x),
  }
}

function createStraightFenceSpanPart(
  start: [number, number],
  end: [number, number],
  centerY: number,
  height: number,
  depth: number,
): FencePart | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-4) {
    return null
  }

  return {
    position: [(start[0] + end[0]) / 2, centerY, (start[1] + end[1]) / 2],
    rotationY: -Math.atan2(dz, dx),
    scale: [length, height, depth],
  }
}

function createFenceCurveSpanParts(
  fence: FenceNode,
  startT: number,
  endT: number,
  centerY: number,
  height: number,
  depth: number,
): FencePart[] {
  const parts: FencePart[] = []
  const frameCount = Math.max(
    1,
    Math.ceil((getWallCurveLength(fence) * Math.max(1e-4, endT - startT)) / MIN_CURVE_SEGMENT_LENGTH),
  )

  let previous = getFencePointAt(fence, startT)
  for (let index = 1; index <= frameCount; index += 1) {
    const t = startT + (endT - startT) * (index / frameCount)
    const current = getFencePointAt(fence, t)
    const segment = createStraightFenceSpanPart(
      [previous.point.x, previous.point.y],
      [current.point.x, current.point.y],
      centerY,
      height,
      depth,
    )
    if (segment) {
      parts.push(segment)
    }
    previous = current
  }

  return parts
}

function applyFenceUVs(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')

  if (!(position && normal)) return

  const uvs = new Float32Array(position.count * 2)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY

  for (let index = 0; index < position.count; index += 1) {
    minX = Math.min(minX, position.getX(index))
    minY = Math.min(minY, position.getY(index))
    minZ = Math.min(minZ, position.getZ(index))
  }

  for (let index = 0; index < position.count; index += 1) {
    const px = position.getX(index)
    const py = position.getY(index)
    const pz = position.getZ(index)
    const nx = Math.abs(normal.getX(index))
    const ny = Math.abs(normal.getY(index))
    const nz = Math.abs(normal.getZ(index))

    let u = 0
    let v = 0

    if (ny >= nx && ny >= nz) {
      u = px - minX
      v = pz - minZ
    } else if (nx >= nz) {
      u = pz - minZ
      v = py - minY
    } else {
      u = px - minX
      v = py - minY
    }

    uvs[index * 2] = u
    uvs[index * 2 + 1] = v
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs.slice(), 2))
}

function getStyleDefaults(style: FenceNode['style']) {
  if (style === 'privacy') {
    return { spacingFactor: 0.42, postFactor: 1.35, baseFactor: 1.2, topFactor: 1.2 }
  }

  if (style === 'rail') {
    return { spacingFactor: 0.68, postFactor: 0.8, baseFactor: 0.85, topFactor: 0.85 }
  }

  return { spacingFactor: 0.3, postFactor: 0.55, baseFactor: 1, topFactor: 0.75 }
}

function createFenceParts(fence: FenceNode): FencePart[] {
  const parts: FencePart[] = []
  const length = Math.max(getWallCurveLength(fence), 0.01)
  const panelDepth = Math.max(fence.thickness, 0.03)
  const clearance = Math.max(fence.groundClearance, 0)
  const styleDefaults = getStyleDefaults(fence.style)
  const baseHeight = Math.max(fence.baseHeight * styleDefaults.baseFactor, 0.04)
  const topRailHeight = Math.max(fence.topRailHeight * styleDefaults.topFactor, 0.01)
  const verticalHeight = Math.max(fence.height - baseHeight - topRailHeight, 0.08)
  const postWidth = Math.max(fence.postSize * styleDefaults.postFactor, 0.01)
  const spacing = Math.max(fence.postSpacing * styleDefaults.spacingFactor, postWidth * 1.2)
  const edgeInset = Math.max(fence.edgeInset ?? 0.015, 0.005)
  const isFloating = fence.baseStyle === 'floating'
  const baseY = isFloating ? clearance : 0
  const effectiveBaseHeight = baseHeight
  const startInsetT = Math.min(0.499, edgeInset / length)
  const endInsetT = Math.max(0.501, 1 - edgeInset / length)

  if (!isFloating) {
    parts.push(
      ...createFenceCurveSpanParts(
        fence,
        0,
        1,
        baseY + effectiveBaseHeight / 2,
        effectiveBaseHeight,
        panelDepth * 1.05,
      ),
    )
    parts.push(
      ...createFenceCurveSpanParts(
        fence,
        0,
        1,
        baseY + effectiveBaseHeight + verticalHeight * 0.15,
        topRailHeight * 0.8,
        panelDepth * 0.35,
      ),
    )
  }

  const count = Math.max(2, Math.floor((length - edgeInset * 2) / spacing) + 1)
  const verticalY = baseY + effectiveBaseHeight + verticalHeight / 2

  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : startInsetT + (endInsetT - startInsetT) * (index / (count - 1))
    const frame = getFencePointAt(fence, t)
    const isEdgePost = index === 0 || index === count - 1
    const postHeight =
      isFloating && isEdgePost
        ? effectiveBaseHeight + verticalHeight + topRailHeight + clearance
        : verticalHeight
    const postY = isFloating && isEdgePost ? postHeight / 2 : verticalY

    parts.push({
      position: [frame.point.x, postY, frame.point.y],
      rotationY: -frame.tangentAngle,
      scale: [postWidth, postHeight, Math.max(panelDepth * 0.35, 0.012)],
    })
  }

  parts.push(
    ...createFenceCurveSpanParts(
      fence,
      0,
      1,
      baseY + effectiveBaseHeight + verticalHeight + topRailHeight / 2,
      topRailHeight,
      Math.max(panelDepth * 0.55, 0.018),
    ),
  )

  if (isFloating) {
    parts.push(
      ...createFenceCurveSpanParts(
        fence,
        0,
        1,
        baseY + effectiveBaseHeight + topRailHeight / 2,
        topRailHeight,
        Math.max(panelDepth * 0.55, 0.018),
      ),
    )
  }

  return parts
}

function generateFenceGeometry(fence: FenceNode) {
  const parts = createFenceParts(fence)
  const geometries = parts.map(createFencePartGeometry)

  const merged = mergeGeometries(geometries, false) ?? new THREE.BufferGeometry()
  geometries.forEach((geometry) => geometry.dispose())
  const mergedUv = merged.getAttribute('uv')
  if (mergedUv) {
    merged.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(mergedUv.array), 2))
  }
  merged.computeVertexNormals()
  return merged
}

function updateFenceGeometry(fenceId: FenceNode['id']) {
  const node = useScene.getState().nodes[fenceId]
  if (!node || node.type !== 'fence') return

  const mesh = sceneRegistry.nodes.get(fenceId) as THREE.Mesh | undefined
  if (!mesh) return

  const newGeometry = generateFenceGeometry(node)
  mesh.geometry.dispose()
  mesh.geometry = newGeometry
  mesh.position.set(0, 0, 0)
  mesh.rotation.set(0, 0, 0)
}

export const FenceSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'fence') return
      updateFenceGeometry(id as FenceNode['id'])
      clearDirty(id as AnyNodeId)
    })
  }, 4)

  return null
}
