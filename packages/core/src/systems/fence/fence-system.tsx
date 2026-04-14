import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, FenceNode } from '../../schema'
import useScene from '../../store/use-scene'

type FencePart = {
  position: [number, number, number]
  scale: [number, number, number]
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
  const length = Math.max(
    Math.hypot(fence.end[0] - fence.start[0], fence.end[1] - fence.start[1]),
    0.01,
  )
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

  if (!isFloating) {
    parts.push({
      position: [0, baseY + effectiveBaseHeight / 2, 0],
      scale: [length, effectiveBaseHeight, panelDepth * 1.05],
    })
    parts.push({
      position: [0, baseY + effectiveBaseHeight + verticalHeight * 0.15, 0],
      scale: [length, topRailHeight * 0.8, panelDepth * 0.35],
    })
  }

  const count = Math.max(2, Math.floor((length - edgeInset * 2) / spacing) + 1)
  const step = count > 1 ? (length - edgeInset * 2) / (count - 1) : 0
  const startX = -length / 2 + edgeInset
  const verticalY = baseY + effectiveBaseHeight + verticalHeight / 2

  for (let index = 0; index < count; index += 1) {
    const x = count === 1 ? 0 : startX + step * index
    let posX = x
    const isEdgePost = index === 0 || index === count - 1
    if (count > 1) {
      if (index === 0) posX = -length / 2 + edgeInset + postWidth / 2
      else if (index === count - 1) posX = length / 2 - edgeInset - postWidth / 2
    }
    const postHeight =
      isFloating && isEdgePost
        ? effectiveBaseHeight + verticalHeight + topRailHeight + clearance
        : verticalHeight
    const postY = isFloating && isEdgePost ? postHeight / 2 : verticalY

    parts.push({
      position: [posX, postY, 0],
      scale: [postWidth, postHeight, Math.max(panelDepth * 0.35, 0.012)],
    })
  }

  parts.push({
    position: [0, baseY + effectiveBaseHeight + verticalHeight + topRailHeight / 2, 0],
    scale: [length, topRailHeight, Math.max(panelDepth * 0.55, 0.018)],
  })

  if (isFloating) {
    parts.push({
      position: [0, baseY + effectiveBaseHeight + topRailHeight / 2, 0],
      scale: [length, topRailHeight, Math.max(panelDepth * 0.55, 0.018)],
    })
  }

  return parts
}

function generateFenceGeometry(fence: FenceNode) {
  const parts = createFenceParts(fence)
  const geometries = parts.map((part) => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    geometry.scale(part.scale[0], part.scale[1], part.scale[2])
    geometry.translate(part.position[0], part.position[1], part.position[2])
    return geometry
  })

  const merged = mergeGeometries(geometries, false) ?? new THREE.BufferGeometry()
  geometries.forEach((geometry) => geometry.dispose())
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

  const centerX = (node.start[0] + node.end[0]) / 2
  const centerZ = (node.start[1] + node.end[1]) / 2
  const angle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  mesh.position.set(centerX, 0, centerZ)
  mesh.rotation.set(0, -angle, 0)
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
