'use client'

import { memo, useMemo } from 'react'
import * as THREE from 'three'
import type { Bounds, ElementSpec, SelectionStyle } from '@/lib/engine'

interface SelectionRendererProps {
  spec: ElementSpec
  bounds: Bounds
  worldPosition: [number, number, number]
  levelYOffset: number
}

/**
 * Renders selection outline/highlighting based on spec style
 */
export const SelectionRenderer = memo(({
  spec,
  bounds,
  worldPosition,
  levelYOffset,
}: SelectionRendererProps) => {
  const selectionConfig = spec.render?.selection
  if (!selectionConfig) return null

  const color = selectionConfig.color ?? '#ffffff'
  const emissiveIntensity = selectionConfig.emissiveIntensity ?? 0.5
  const style = selectionConfig.style
  const outlineWidth = selectionConfig.outlineWidth ?? 0.02

  // Calculate bounding box dimensions
  const { min, max } = bounds.aabb
  const size: [number, number, number] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ]
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2 + levelYOffset,
    (min[2] + max[2]) / 2,
  ]

  switch (style) {
    case 'box':
      return <BoxOutline center={center} size={size} color={color} emissiveIntensity={emissiveIntensity} />
    
    case 'edges':
      return <EdgeOutlines center={center} size={size} color={color} emissiveIntensity={emissiveIntensity} outlineWidth={outlineWidth} />
    
    case 'outline':
      return <WireframeOutline center={center} size={size} color={color} emissiveIntensity={emissiveIntensity} />
    
    case 'glow':
      return <GlowEffect center={center} size={size} color={color} />
    
    default:
      return <BoxOutline center={center} size={size} color={color} emissiveIntensity={emissiveIntensity} />
  }
})

SelectionRenderer.displayName = 'SelectionRenderer'

// Box outline (wireframe box)
const BoxOutline = memo(({ center, size, color, emissiveIntensity }: {
  center: [number, number, number]
  size: [number, number, number]
  color: string
  emissiveIntensity: number
}) => {
  const geometry = useMemo(() => new THREE.BoxGeometry(...size), [size])

  return (
    <mesh geometry={geometry} position={center} renderOrder={999}>
      <meshStandardMaterial
        color={color}
        depthTest={false}
        emissive={color}
        emissiveIntensity={emissiveIntensity}
        wireframe
      />
    </mesh>
  )
})

BoxOutline.displayName = 'BoxOutline'

// Edge outlines (thicker edges at corners)
const EdgeOutlines = memo(({ center, size, color, emissiveIntensity, outlineWidth }: {
  center: [number, number, number]
  size: [number, number, number]
  color: string
  emissiveIntensity: number
  outlineWidth: number
}) => {
  // Create cylinders for edges
  const edges = useMemo(() => {
    const [w, h, d] = size
    const hw = w / 2
    const hh = h / 2
    const hd = d / 2

    // Corner vertices
    const corners = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd], // Bottom
      [-hw, hh, -hd], [hw, hh, -hd], [hw, hh, hd], [-hw, hh, hd],     // Top
    ]

    // Edge connections (indices into corners array)
    const connections = [
      // Bottom edges
      [0, 1], [1, 2], [2, 3], [3, 0],
      // Top edges
      [4, 5], [5, 6], [6, 7], [7, 4],
      // Vertical edges
      [0, 4], [1, 5], [2, 6], [3, 7],
    ]

    return connections.map(([a, b], idx) => {
      const start = new THREE.Vector3(...corners[a])
      const end = new THREE.Vector3(...corners[b])
      const length = start.distanceTo(end)
      const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
      
      // Calculate rotation
      const direction = new THREE.Vector3().subVectors(end, start).normalize()
      const axis = new THREE.Vector3(0, 1, 0).cross(direction).normalize()
      const angle = Math.acos(new THREE.Vector3(0, 1, 0).dot(direction))

      return {
        key: idx,
        position: midpoint,
        rotation: new THREE.Quaternion().setFromAxisAngle(axis, angle),
        length,
      }
    })
  }, [size])

  const cylinderGeometry = useMemo(() => 
    new THREE.CylinderGeometry(outlineWidth, outlineWidth, 1, 8),
    [outlineWidth]
  )

  return (
    <group position={center}>
      {edges.map((edge) => (
        <mesh
          geometry={cylinderGeometry}
          key={edge.key}
          position={edge.position}
          quaternion={edge.rotation}
          renderOrder={999}
          scale={[1, edge.length, 1]}
        >
          <meshStandardMaterial
            color={color}
            depthTest={false}
            emissive={color}
            emissiveIntensity={emissiveIntensity}
          />
        </mesh>
      ))}
    </group>
  )
})

EdgeOutlines.displayName = 'EdgeOutlines'

// Wireframe outline (similar to box but with more detail)
const WireframeOutline = memo(({ center, size, color, emissiveIntensity }: {
  center: [number, number, number]
  size: [number, number, number]
  color: string
  emissiveIntensity: number
}) => {
  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(...size)
    return new THREE.EdgesGeometry(geo)
  }, [size])

  return (
    <lineSegments geometry={geometry} position={center} renderOrder={999}>
      <lineBasicMaterial color={color} depthTest={false} />
    </lineSegments>
  )
})

WireframeOutline.displayName = 'WireframeOutline'

// Glow effect (semi-transparent enlarged box)
const GlowEffect = memo(({ center, size, color }: {
  center: [number, number, number]
  size: [number, number, number]
  color: string
}) => {
  const geometry = useMemo(() => {
    const expandedSize: [number, number, number] = [
      size[0] * 1.1,
      size[1] * 1.1,
      size[2] * 1.1,
    ]
    return new THREE.BoxGeometry(...expandedSize)
  }, [size])

  return (
    <mesh geometry={geometry} position={center} renderOrder={998}>
      <meshStandardMaterial
        color={color}
        depthTest={false}
        emissive={color}
        emissiveIntensity={0.8}
        opacity={0.2}
        transparent
      />
    </mesh>
  )
})

GlowEffect.displayName = 'GlowEffect'

