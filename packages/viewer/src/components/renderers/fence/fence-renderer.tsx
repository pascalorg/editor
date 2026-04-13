import { type FenceNode, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import { BoxGeometry, Group } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { DEFAULT_STAIR_MATERIAL } from '../../../lib/materials'

type FencePart = {
  key: string
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
      key: 'base',
      position: [0, baseY + effectiveBaseHeight / 2, 0],
      scale: [length, effectiveBaseHeight, panelDepth * 1.05],
    })
    parts.push({
      key: 'mid-rail',
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
      key: `vertical-${index}`,
      position: [posX, postY, 0],
      scale: [postWidth, postHeight, Math.max(panelDepth * 0.35, 0.012)],
    })
  }

  parts.push({
    key: 'top-rail',
    position: [0, baseY + effectiveBaseHeight + verticalHeight + topRailHeight / 2, 0],
    scale: [length, topRailHeight, Math.max(panelDepth * 0.55, 0.018)],
  })

  if (isFloating) {
    parts.push({
      key: 'bottom-rail',
      position: [0, baseY + effectiveBaseHeight + topRailHeight / 2, 0],
      scale: [length, topRailHeight, Math.max(panelDepth * 0.55, 0.018)],
    })
  }

  return parts
}

export const FenceRenderer = ({ node }: { node: FenceNode }) => {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'fence')
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const parts = useMemo(() => createFenceParts(node), [node])
  const rotation = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  const center: [number, number, number] = [
    (node.start[0] + node.end[0]) / 2,
    0,
    (node.start[1] + node.end[1]) / 2,
  ]

  useRegistry(node.id, 'fence', ref)

  return (
    <group
      ref={ref}
      rotation={[0, -rotation, 0]}
      visible={node.visible}
      {...handlers}
      position={center}
    >
      {parts.map((part) => (
        <mesh
          castShadow
          geometry={geometry}
          key={part.key}
          material={DEFAULT_STAIR_MATERIAL}
          position={part.position}
          receiveShadow
          scale={part.scale}
        />
      ))}
    </group>
  )
}
