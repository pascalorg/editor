'use client'

import { shaderMaterial } from '@react-three/drei'
import { extend, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Color, DoubleSide } from 'three'

// Custom shader material for infinite grid that fades from center
const InfiniteGridMaterial = shaderMaterial(
  {
    uGridSize: 0.5,
    uLineColor: new Color('#ffffff'),
    uFadeDistance: 40.0,
    uFadeStrength: 2.0,
    uLineWidth: 1.0,
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
    uniform float uFadeDistance;
    uniform float uFadeStrength;
    uniform float uLineWidth;
    
    varying vec3 vWorldPosition;
    
    // Returns vec2: x = line intensity, y = 1.0 if dashed line, 0.0 if solid
    vec2 getDashedGrid(float size) {
      vec2 coord = vWorldPosition.xz / size;
      vec2 derivative = fwidth(coord);
      vec2 grid = abs(fract(coord - 0.5) - 0.5) / derivative;
      
      // Determine which grid line we're on for X and Z
      vec2 gridIndex = floor(coord + 0.5);
      
      // Check if we're on an odd line (dashed)
      bool isOddX = mod(gridIndex.x, 2.0) > 0.5;
      bool isOddZ = mod(gridIndex.y, 2.0) > 0.5;
      
      // Dash parameters
      float dashLength = 0.4; // Length of each dash
      float gapLength = 0.4;  // Length of each gap
      float dashCycle = dashLength + gapLength;
      
      // Calculate line intensities for X and Z directions
      float lineX = 1.0 - min(grid.x * uLineWidth, 1.0);
      float lineZ = 1.0 - min(grid.y * uLineWidth, 1.0);
      
      // Track if current fragment is on a dashed line
      float isDashed = 0.0;
      
      // Apply dashing for odd lines
      if (isOddX && lineX > 0.01) {
        // For X lines (running along Z axis), use Z coordinate for dashing
        float dashPos = mod(coord.y, dashCycle);
        isDashed = 1.0;
        if (dashPos > dashLength) {
          lineX = 0.0;
        }
      }
      
      if (isOddZ && lineZ > 0.01) {
        // For Z lines (running along X axis), use X coordinate for dashing
        float dashPos = mod(coord.x, dashCycle);
        isDashed = 1.0;
        if (dashPos > dashLength) {
          lineZ = 0.0;
        }
      }
      
      return vec2(max(lineX, lineZ), isDashed);
    }
    
    void main() {
      // Distance from world center (0, 0)
      float distanceFromCenter = length(vWorldPosition.xz);
      
      // Fade based on distance from center
      float fadeFactor = 1.0 - smoothstep(uFadeDistance * 0.5, uFadeDistance, distanceFromCenter);
      fadeFactor = pow(fadeFactor, uFadeStrength);
      
      // Get grid lines with dashing info
      vec2 gridResult = getDashedGrid(uGridSize);
      float grid = gridResult.x;
      float isDashed = gridResult.y;
      
      // Apply different opacity for dashed vs solid lines
      float opacityMultiplier = isDashed > 0.5 ? 0.05 : 0.3;
      float alpha = grid * fadeFactor * opacityMultiplier;
      
      if (alpha < 0.01) discard;
      
      gl_FragColor = vec4(uLineColor, alpha);
    }
  `,
)

// Extend the material to make it available in JSX
extend({ InfiniteGridMaterial })

// TypeScript declaration
declare module '@react-three/fiber' {
  interface ThreeElements {
    infiniteGridMaterial: any
  }
}

interface InfiniteGridProps {
  gridSize?: number
  lineColor?: string
  fadeDistance?: number
  fadeStrength?: number
  lineWidth?: number
}

export function InfiniteGrid({
  gridSize = 0.5,
  lineColor = '#ffffff',
  fadeDistance = 40,
  fadeStrength = 2,
  lineWidth = 1.0,
}: InfiniteGridProps) {
  const materialRef = useRef<any>(null)

  useFrame((_state, _delta) => {
    if (materialRef.current) {
      materialRef.current.uFadeDistance = fadeDistance
      materialRef.current.uFadeStrength = fadeStrength
    }
  })

  return (
    <mesh
      frustumCulled={false}
      name="__infinite_grid__"
      position={[0, 0.005, 0]}
      renderOrder={1}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[1000, 1000]} />
      <infiniteGridMaterial
        depthTest
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        ref={materialRef}
        side={DoubleSide}
        transparent
        uFadeDistance={fadeDistance}
        uFadeStrength={fadeStrength}
        uGridSize={gridSize}
        uLineColor={new Color(lineColor)}
        uLineWidth={lineWidth}
      />
    </mesh>
  )
}
