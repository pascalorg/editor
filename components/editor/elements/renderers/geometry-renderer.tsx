'use client'

import { memo, useMemo } from 'react'
import * as THREE from 'three'
import type { ElementSpec, TransformGrid, Visibility } from '@/lib/engine'

interface GeometryRendererProps {
  spec: ElementSpec
  transform: TransformGrid
  visibility: Visibility
  worldPosition: [number, number, number]
  levelYOffset: number
  tileSize: number
  emissiveIntensity: number
  onClick?: (e: THREE.Event) => void
}

/**
 * Renders elements using procedural geometry from spec
 */
export const GeometryRenderer = memo(
  ({
    spec,
    transform,
    visibility,
    worldPosition,
    levelYOffset,
    tileSize,
    emissiveIntensity,
    onClick,
  }: GeometryRendererProps) => {
    const renderConfig = spec.render
    const geometryConfig = renderConfig?.geometry
    const { type = 'box', dimensions = {} } = geometryConfig ?? {}
    const material = renderConfig?.material

    // Create geometry based on type
    const geometry = useMemo(() => {
      switch (type) {
        case 'cylinder': {
          const radius = dimensions.radius ?? 0.5
          const height = dimensions.height ?? 1
          const radialSegments = dimensions.radialSegments ?? 16
          return new THREE.CylinderGeometry(radius, radius, height, radialSegments)
        }
        case 'box': {
          const width = dimensions.width ?? 1
          const height = dimensions.height ?? 1
          const depth = dimensions.depth ?? 1
          return new THREE.BoxGeometry(width, height, depth)
        }
        case 'plane': {
          const width = dimensions.width ?? 1
          const depth = dimensions.depth ?? 1
          const geometry = new THREE.PlaneGeometry(width, depth)
          geometry.rotateX(-Math.PI / 2) // Lie flat
          return geometry
        }
        default:
          console.warn(`Unknown geometry type: ${type}`)
          return new THREE.BoxGeometry(1, 1, 1)
      }
    }, [type, dimensions])

    // Calculate final opacity
    const baseOpacity = material?.opacity ?? 1
    const visibilityOpacity = visibility.opacity / 100
    const finalOpacity = baseOpacity * visibilityOpacity

    // Early return if no geometry config
    if (!geometryConfig) return null

    // Position adjustment for cylinder (centered at half height)
    const yOffset = type === 'cylinder' ? (dimensions.height ?? 1) / 2 : 0

    return (
      <mesh
        castShadow
        geometry={geometry}
        onClick={onClick}
        position={[worldPosition[0], worldPosition[1] + levelYOffset + yOffset, worldPosition[2]]}
        receiveShadow
        rotation={[0, transform.rotation, 0]}
      >
        <meshStandardMaterial
          color={material?.color ?? '#ffffff'}
          emissive={material?.emissive ?? material?.color ?? '#ffffff'}
          emissiveIntensity={emissiveIntensity}
          metalness={material?.metalness ?? 0}
          opacity={finalOpacity}
          roughness={material?.roughness ?? 1}
          transparent={finalOpacity < 1 || material?.transparent}
        />
      </mesh>
    )
  },
)

GeometryRenderer.displayName = 'GeometryRenderer'
