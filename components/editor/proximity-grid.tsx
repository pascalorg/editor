'use client'

import { shaderMaterial } from '@react-three/drei'
import { extend, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, DoubleSide, Vector2 } from 'three'
import type { Component } from '@/hooks/use-editor'

// Create empty arrays for uniforms with proper initialization
const createEmptyVector2Array = (size: number): Vector2[] => {
  const arr: Vector2[] = []
  for (let i = 0; i < size; i++) {
    arr.push(new Vector2(0, 0))
  }
  return arr
}

// Custom shader material for proximity-based grid
const ProximityGridMaterial = shaderMaterial(
  {
    uGridSize: 0.5,
    uLineColor: new Color('#ffffff'),
    uLineWidth: 1.0,
    uOpacity: 0.3,
    uPadding: 1.5, // Distance in world units to show grid around elements
    uSegments: createEmptyVector2Array(200), // Array of line segment endpoints
    uSegmentCount: 0,
    uPoints: createEmptyVector2Array(100), // Array of point positions
    uPointCount: 0,
    uFadeWidth: 0.5, // Width of fade falloff
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
    uniform float uPadding;
    uniform vec2 uSegments[200]; // Flat array: start1, end1, start2, end2, ...
    uniform int uSegmentCount; // Number of segments (not points)
    uniform vec2 uPoints[100];
    uniform int uPointCount;
    uniform float uFadeWidth;
    
    varying vec3 vWorldPosition;
    
    float getGrid(float size) {
      vec2 coord = vWorldPosition.xz / size;
      vec2 derivative = fwidth(coord);
      vec2 grid = abs(fract(coord - 0.5) - 0.5) / derivative;
      float line = min(grid.x, grid.y);
      return 1.0 - min(line * uLineWidth, 1.0);
    }
    
    // Distance from point to line segment
    float distanceToSegment(vec2 p, vec2 a, vec2 b) {
      vec2 pa = p - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      return length(pa - ba * h);
    }
    
    // Distance from point to point
    float distanceToPoint(vec2 p, vec2 point) {
      return length(p - point);
    }
    
    // Find minimum distance to any element
    float minDistanceToElements(vec2 pos) {
      float minDist = 999999.0;
      
      // Check distance to all line segments
      // Each segment uses 2 consecutive vec2 entries (start, end)
      for (int i = 0; i < 100; i++) {
        if (i >= uSegmentCount) break;
        vec2 start = uSegments[i * 2];
        vec2 end = uSegments[i * 2 + 1];
        float dist = distanceToSegment(pos, start, end);
        minDist = min(minDist, dist);
      }
      
      // Check distance to all points
      for (int i = 0; i < 100; i++) {
        if (i >= uPointCount) break;
        float dist = distanceToPoint(pos, uPoints[i]);
        minDist = min(minDist, dist);
      }
      
      return minDist;
    }
    
    void main() {
      vec2 pos = vWorldPosition.xz;
      
      // Calculate minimum distance to any element
      float distToElement = minDistanceToElements(pos);
      
      // Calculate proximity fade (1.0 at element, 0.0 at padding distance)
      float proximityFade = 1.0 - smoothstep(uPadding - uFadeWidth, uPadding, distToElement);
      
      // If too far from any element, discard
      if (proximityFade < 0.01) discard;
      
      // Get grid lines
      float grid = getGrid(uGridSize);
      float alpha = grid * uOpacity * proximityFade;
      
      if (alpha < 0.01) discard;
      
      gl_FragColor = vec4(uLineColor, alpha);
    }
  `,
)

// Extend the material to make it available in JSX
extend({ ProximityGridMaterial })

// TypeScript declaration
declare module '@react-three/fiber' {
  interface ThreeElements {
    proximityGridMaterial: any
  }
}

interface ProximityGridProps {
  components: Component[]
  floorId: string
  gridSize?: number
  lineColor?: string
  lineWidth?: number
  opacity?: number
  padding?: number // Distance in world units to show grid around elements
  fadeWidth?: number // Width of fade falloff in world units
  offset?: [number, number] // Coordinate system offset
  maxSize?: number // Maximum grid size to render
  cursorPosition?: [number, number] | null // Current cursor position in grid coordinates
}

/**
 * ProximityGrid - renders grid only near placed elements
 * Creates a "spray paint" effect around walls, roofs, and doors
 */
export function ProximityGrid({
  components,
  floorId,
  gridSize = 0.5,
  lineColor = '#ffffff',
  lineWidth = 1.0,
  opacity = 0.3,
  padding = 1.5, // 1.5m around elements
  fadeWidth = 0.5, // 0.5m fade
  offset = [0, 0],
  maxSize = 100, // 100m x 100m max
  cursorPosition = null,
}: ProximityGridProps) {
  const materialRef = useRef<any>(null)

  // Extract all segments and points from components
  const { segments, points } = useMemo(() => {
    const segments: Vector2[] = []
    const points: Vector2[] = []

    // Get wall segments
    const wallComponent = components.find((c) => c.type === 'wall' && c.group === floorId)
    if (wallComponent && wallComponent.type === 'wall') {
      for (const segment of wallComponent.data.segments) {
        if (segment.visible === false) continue
        const [x1, y1] = segment.start
        const [x2, y2] = segment.end
        // Convert grid coordinates to world coordinates
        const worldX1 = x1 * gridSize + offset[0]
        const worldY1 = y1 * gridSize + offset[1]
        const worldX2 = x2 * gridSize + offset[0]
        const worldY2 = y2 * gridSize + offset[1]
        segments.push(new Vector2(worldX1, worldY1))
        segments.push(new Vector2(worldX2, worldY2))
      }
    }

    // Get roof segments (ridge lines)
    const roofComponent = components.find((c) => c.type === 'roof' && c.group === floorId)
    if (roofComponent && roofComponent.type === 'roof') {
      for (const segment of roofComponent.data.segments) {
        if (segment.visible === false) continue
        const [x1, y1] = segment.start
        const [x2, y2] = segment.end
        const worldX1 = x1 * gridSize + offset[0]
        const worldY1 = y1 * gridSize + offset[1]
        const worldX2 = x2 * gridSize + offset[0]
        const worldY2 = y2 * gridSize + offset[1]
        segments.push(new Vector2(worldX1, worldY1))
        segments.push(new Vector2(worldX2, worldY2))
      }
    }

    // Get door positions
    const doorComponents = components.filter((c) => c.type === 'door' && c.group === floorId)
    for (const doorComponent of doorComponents) {
      if (doorComponent.type === 'door') {
        const [x, y] = doorComponent.data.position
        const worldX = x * gridSize + offset[0]
        const worldY = y * gridSize + offset[1]
        points.push(new Vector2(worldX, worldY))
      }
    }

    // Add cursor position as a point to reveal grid around it
    if (cursorPosition) {
      const [x, y] = cursorPosition
      const worldX = x * gridSize + offset[0]
      const worldY = y * gridSize + offset[1]
      points.push(new Vector2(worldX, worldY))
    }

    return { segments, points }
  }, [components, floorId, gridSize, offset, cursorPosition])

  // Update material uniforms
  useFrame(() => {
    if (materialRef.current) {
      // Pad arrays to match the shader's expected size
      const paddedSegments = [...segments]
      while (paddedSegments.length < 200) {
        paddedSegments.push(new Vector2(0, 0))
      }

      const paddedPoints = [...points]
      while (paddedPoints.length < 100) {
        paddedPoints.push(new Vector2(0, 0))
      }

      materialRef.current.uSegments = paddedSegments
      materialRef.current.uSegmentCount = Math.floor(segments.length / 2)
      materialRef.current.uPoints = paddedPoints
      materialRef.current.uPointCount = points.length
    }
  })

  // Don't render if no elements and no cursor
  if (segments.length === 0 && points.length === 0 && !cursorPosition) {
    return null
  }

  // Pad arrays to match the shader's expected size
  const paddedSegments = [...segments]
  while (paddedSegments.length < 200) {
    paddedSegments.push(new Vector2(0, 0))
  }

  const paddedPoints = [...points]
  while (paddedPoints.length < 100) {
    paddedPoints.push(new Vector2(0, 0))
  }

  return (
    <mesh position={[0, 0.005, 0]} renderOrder={-1} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[maxSize, maxSize]} />
      <proximityGridMaterial
        depthTest
        depthWrite={false}
        key={`${segments.length}-${points.length}`} // Force remount when elements change
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        ref={materialRef}
        side={DoubleSide}
        transparent
        uFadeWidth={fadeWidth}
        uGridSize={gridSize}
        uLineColor={new Color(lineColor)}
        uLineWidth={lineWidth}
        uOpacity={opacity}
        uPadding={padding}
        uPointCount={points.length}
        uPoints={paddedPoints}
        uSegmentCount={Math.floor(segments.length / 2)}
        uSegments={paddedSegments}
      />
    </mesh>
  )
}
