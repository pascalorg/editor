'use client'

import { shaderMaterial } from '@react-three/drei'
import { extend } from '@react-three/fiber'
import { useMemo } from 'react'
import { Color, DoubleSide } from 'three'

// Custom shader material for bounded grid
const BoundedGridMaterial = shaderMaterial(
  {
    uGridSize: 0.5,
    uLineColor: new Color('#ffffff'),
    uLineWidth: 1.0,
    uOpacity: 0.3,
  },
  // Vertex Shader
  /* glsl */ `
    varying vec3 vWorldPosition;
    
    void main() {
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Fragment Shader
  /* glsl */ `
    uniform float uGridSize;
    uniform vec3 uLineColor;
    uniform float uLineWidth;
    uniform float uOpacity;
    
    varying vec3 vWorldPosition;
    
    float getGrid(float size) {
      vec2 coord = vWorldPosition.xz / size;
      vec2 derivative = fwidth(coord);
      vec2 grid = abs(fract(coord - 0.5) - 0.5) / derivative;
      float line = min(grid.x, grid.y);
      return 1.0 - min(line * uLineWidth, 1.0);
    }
    
    void main() {
      float grid = getGrid(uGridSize);
      float alpha = grid * uOpacity;
      
      if (alpha < 0.01) discard;
      
      gl_FragColor = vec4(uLineColor, alpha);
    }
  `,
)

// Extend the material to make it available in JSX
extend({ BoundedGridMaterial })

// TypeScript declaration
declare module '@react-three/fiber' {
  interface ThreeElements {
    boundedGridMaterial: any
  }
}

/**
 * Bounds in 3D space matching Three.js coordinate system:
 * - X: horizontal (east-west)
 * - Y: vertical (up-down) - determined by floor level
 * - Z: horizontal depth (north-south)
 *
 * For 2D floor footprints, Y is implicit (floor level)
 */
export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

interface BoundedGridProps {
  bounds: Bounds
  gridSize?: number
  lineColor?: string
  lineWidth?: number
  opacity?: number
  padding?: number // Number of tiles to pad around the bounds
  offset?: [number, number] // Offset to apply (e.g., [-GRID_SIZE/2, -GRID_SIZE/2])
}

/**
 * BoundedGrid - renders a limited grid area around specific bounds
 * Used for non-base levels to show only a few tiles around placed elements
 */
export function BoundedGrid({
  bounds,
  gridSize = 0.5,
  lineColor = '#ffffff',
  lineWidth = 1.0,
  opacity = 0.15,
  padding = 3, // 3 tiles padding by default
  offset = [0, 0], // Default no offset
}: BoundedGridProps) {
  // Calculate the actual render dimensions with padding
  const dimensions = useMemo(() => {
    const paddedMinX = (bounds.minX - padding) * gridSize
    const paddedMaxX = (bounds.maxX + padding) * gridSize
    const paddedMinZ = (bounds.minZ - padding) * gridSize
    const paddedMaxZ = (bounds.maxZ + padding) * gridSize

    const width = paddedMaxX - paddedMinX
    const depth = paddedMaxZ - paddedMinZ
    // Apply offset to center position to convert from local to world coordinates
    const centerX = (paddedMinX + paddedMaxX) / 2 + offset[0]
    const centerZ = (paddedMinZ + paddedMaxZ) / 2 + offset[1]

    return { width, depth, centerX, centerZ }
  }, [bounds, padding, gridSize, offset])

  return (
    <mesh
      position={[dimensions.centerX, 0.005, dimensions.centerZ]}
      renderOrder={-1}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[dimensions.width, dimensions.depth]} />
      <boundedGridMaterial
        depthTest
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        side={DoubleSide}
        transparent
        uGridSize={gridSize}
        uLineColor={new Color(lineColor)}
        uLineWidth={lineWidth}
        uOpacity={opacity}
      />
    </mesh>
  )
}
