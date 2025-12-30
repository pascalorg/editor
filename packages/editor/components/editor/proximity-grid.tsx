'use client'

import { shaderMaterial } from '@react-three/drei'
import { extend, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, DoubleSide, Vector2 } from 'three'
import { useEditor } from '@/hooks/use-editor'
import type { SceneNode } from '@pascal/core'

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
  components: SceneNode[]
  floorId: string
  gridSize?: number
  lineColor?: string
  lineWidth?: number
  opacity?: number
  padding?: number // Distance in world units to show grid around elements
  fadeWidth?: number // Width of fade falloff in world units
  offset?: [number, number] // Coordinate system offset
  maxSize?: number // Maximum grid size to render
  // Preview elements (for showing grid under elements being placed)
  previewWall?: { start: [number, number]; end: [number, number] } | null
  previewRoof?: { corner1: [number, number]; corner2: [number, number] } | null // Rectangle footprint
  previewRoom?: { corner1: [number, number]; corner2: [number, number] } | null // Room with 4 walls
  previewCustomRoom?: {
    points: Array<[number, number]>
    previewEnd: [number, number] | null
  } | null // Custom room (multiline)
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
  previewWall = null,
  previewRoof = null,
  previewRoom = null,
  previewCustomRoom = null,
}: ProximityGridProps) {
  const materialRef = useRef<any>(null)

  // const pointerPosition = useEditor((state) => state.pointerPosition)

  // Extract all segments and points from components
  const { segments, points } = useMemo(() => {
    const segments: Vector2[] = []
    const points: Vector2[] = []

    // Iterate through all components
    for (const component of components) {
      // Handle Walls
      if (component.type === 'wall') {
        if (component.visible === false) continue

        const [x1, y1] = component.start
        const [x2, y2] = component.end

        // Convert grid coordinates to world coordinates
        const worldX1 = x1 * gridSize + offset[0]
        const worldY1 = y1 * gridSize + offset[1]
        const worldX2 = x2 * gridSize + offset[0]
        const worldY2 = y2 * gridSize + offset[1]

        segments.push(new Vector2(worldX1, worldY1))
        segments.push(new Vector2(worldX2, worldY2))

        // Handle Doors (children of walls)
        if ('children' in component && Array.isArray(component.children)) {
          for (const child of component.children) {
            if (child.type === 'door') {
              // Calculate door position in world space
              // Door position [x, y] is relative to wall start
              // We need to interpolate along the wall vector
              const doorX = child.position[0]
              // Vector along wall
              const dx = x2 - x1
              const dy = y2 - y1
              const len = Math.sqrt(dx * dx + dy * dy)
              if (len > 0) {
                const dirX = dx / len
                const dirY = dy / len

                const doorWorldX = (x1 + dirX * doorX) * gridSize + offset[0]
                const doorWorldY = (y1 + dirY * doorX) * gridSize + offset[1]

                points.push(new Vector2(doorWorldX, doorWorldY))
              }
            }
          }
        }
      }

      // Handle Roofs
      if (component.type === 'roof') {
        if (component.visible === false) continue

        const [x1, y1] = component.position
        const length = component.size[0]
        const x2 = x1 + Math.cos(component.rotation) * length
        const y2 = y1 - Math.sin(component.rotation) * length

        const leftWidth = component.leftWidth || 0
        const rightWidth = component.rightWidth || 0

        // Calculate perpendicular direction to ridge line
        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)

        if (len > 0) {
          // Perpendicular unit vector (rotate 90 degrees)
          const perpX = -dy / len
          const perpY = dx / len

          // Convert widths from world units to grid units
          const leftWidthGrid = leftWidth / gridSize
          const rightWidthGrid = rightWidth / gridSize

          // Calculate the 4 corners of the roof footprint
          const corner1X = x1 - perpX * leftWidthGrid
          const corner1Y = y1 - perpY * leftWidthGrid
          const corner2X = x1 + perpX * rightWidthGrid
          const corner2Y = y1 + perpY * rightWidthGrid
          const corner3X = x2 + perpX * rightWidthGrid
          const corner3Y = y2 + perpY * rightWidthGrid
          const corner4X = x2 - perpX * leftWidthGrid
          const corner4Y = y2 - perpY * leftWidthGrid

          // Convert to world coordinates
          const worldC1X = corner1X * gridSize + offset[0]
          const worldC1Y = corner1Y * gridSize + offset[1]
          const worldC2X = corner2X * gridSize + offset[0]
          const worldC2Y = corner2Y * gridSize + offset[1]
          const worldC3X = corner3X * gridSize + offset[0]
          const worldC3Y = corner3Y * gridSize + offset[1]
          const worldC4X = corner4X * gridSize + offset[0]
          const worldC4Y = corner4Y * gridSize + offset[1]

          // Add all 4 edges of the rectangular footprint
          segments.push(new Vector2(worldC1X, worldC1Y))
          segments.push(new Vector2(worldC2X, worldC2Y))

          segments.push(new Vector2(worldC2X, worldC2Y))
          segments.push(new Vector2(worldC3X, worldC3Y))

          segments.push(new Vector2(worldC3X, worldC3Y))
          segments.push(new Vector2(worldC4X, worldC4Y))

          segments.push(new Vector2(worldC4X, worldC4Y))
          segments.push(new Vector2(worldC1X, worldC1Y))
        }
      }
    }

    // Add preview wall segment if it exists
    if (previewWall) {
      const [x1, y1] = previewWall.start
      const [x2, y2] = previewWall.end
      const worldX1 = x1 * gridSize + offset[0]
      const worldY1 = y1 * gridSize + offset[1]
      const worldX2 = x2 * gridSize + offset[0]
      const worldY2 = y2 * gridSize + offset[1]
      segments.push(new Vector2(worldX1, worldY1))
      segments.push(new Vector2(worldX2, worldY2))
    }

    // Add preview roof rectangular footprint if it exists (all 4 edges)
    if (previewRoof) {
      const [x1, y1] = previewRoof.corner1
      const [x2, y2] = previewRoof.corner2

      // Calculate the four corners of the rectangle
      const minX = Math.min(x1, x2)
      const maxX = Math.max(x1, x2)
      const minY = Math.min(y1, y2)
      const maxY = Math.max(y1, y2)

      // Convert to world coordinates
      const worldMinX = minX * gridSize + offset[0]
      const worldMaxX = maxX * gridSize + offset[0]
      const worldMinY = minY * gridSize + offset[1]
      const worldMaxY = maxY * gridSize + offset[1]

      // Add all 4 edges of the rectangle
      // Top edge
      segments.push(new Vector2(worldMinX, worldMaxY))
      segments.push(new Vector2(worldMaxX, worldMaxY))
      // Bottom edge
      segments.push(new Vector2(worldMinX, worldMinY))
      segments.push(new Vector2(worldMaxX, worldMinY))
      // Left edge
      segments.push(new Vector2(worldMinX, worldMinY))
      segments.push(new Vector2(worldMinX, worldMaxY))
      // Right edge
      segments.push(new Vector2(worldMaxX, worldMinY))
      segments.push(new Vector2(worldMaxX, worldMaxY))
    }

    // Add preview room (4 walls forming a rectangle)
    if (previewRoom) {
      const [x1, y1] = previewRoom.corner1
      const [x2, y2] = previewRoom.corner2

      // Calculate the four corners of the rectangle
      const minX = Math.min(x1, x2)
      const maxX = Math.max(x1, x2)
      const minY = Math.min(y1, y2)
      const maxY = Math.max(y1, y2)

      // Convert to world coordinates
      const worldMinX = minX * gridSize + offset[0]
      const worldMaxX = maxX * gridSize + offset[0]
      const worldMinY = minY * gridSize + offset[1]
      const worldMaxY = maxY * gridSize + offset[1]

      // Add all 4 edges of the rectangle
      // Top edge
      segments.push(new Vector2(worldMinX, worldMaxY))
      segments.push(new Vector2(worldMaxX, worldMaxY))
      // Bottom edge
      segments.push(new Vector2(worldMinX, worldMinY))
      segments.push(new Vector2(worldMaxX, worldMinY))
      // Left edge
      segments.push(new Vector2(worldMinX, worldMinY))
      segments.push(new Vector2(worldMinX, worldMaxY))
      // Right edge
      segments.push(new Vector2(worldMaxX, worldMinY))
      segments.push(new Vector2(worldMaxX, worldMaxY))
    }

    // Add preview custom room (multiline polygon)
    if (previewCustomRoom && previewCustomRoom.points.length > 0) {
      const allPoints = [...previewCustomRoom.points]

      // If there's a preview end point, include it
      if (previewCustomRoom.previewEnd) {
        allPoints.push(previewCustomRoom.previewEnd)
      }

      // Add segments between consecutive points
      for (let i = 0; i < allPoints.length - 1; i++) {
        const [x1, y1] = allPoints[i]
        const [x2, y2] = allPoints[i + 1]
        const worldX1 = x1 * gridSize + offset[0]
        const worldY1 = y1 * gridSize + offset[1]
        const worldX2 = x2 * gridSize + offset[0]
        const worldY2 = y2 * gridSize + offset[1]
        segments.push(new Vector2(worldX1, worldY1))
        segments.push(new Vector2(worldX2, worldY2))
      }
    }

    // Add cursor position as a point to reveal grid around it
    // if (pointerPosition) {
    //   const [x, y] = pointerPosition
    //   const worldX = x * gridSize + offset[0]
    //   const worldY = y * gridSize + offset[1]
    //   points.push(new Vector2(worldX, worldY))
    // }

    return { segments, points }
  }, [
    components,
    floorId,
    gridSize,
    offset,
    // pointerPosition,
    previewWall,
    previewRoof,
    previewRoom,
    previewCustomRoom,
  ])

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
  if (segments.length === 0 && points.length === 0) {
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
    <mesh
      name="__proximity_grid__"
      position={[0, 0.005, 0]}
      renderOrder={-1}
      rotation={[-Math.PI / 2, 0, 0]}
    >
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
