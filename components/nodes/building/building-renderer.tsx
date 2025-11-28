'use client'

import { shaderMaterial } from '@react-three/drei'
import { extend, useFrame } from '@react-three/fiber'
import { memo, useRef } from 'react'
import { AdditiveBlending, Color, DoubleSide } from 'three'
import { GRID_SIZE } from '@/components/editor'
import type { BuildingNode } from '@/lib/scenegraph/schema/index'

interface BuildingRendererProps {
  nodeId: BuildingNode['id']
}

/**
 * Building renderer component
 * Returns an empty group for now
 */
export const BuildingRenderer = memo(({ nodeId }: BuildingRendererProps) => {
  const materialRef = useRef<any>(null)

  useFrame(({ clock }, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = clock.elapsedTime
      materialRef.current.lifetime += delta
    }
  })

  return (
    <group>
      <mesh position={[GRID_SIZE / 2, 5.2, GRID_SIZE / 2]}>
        <boxGeometry args={[GRID_SIZE, 10, GRID_SIZE]} />
        {/* @ts-expect-error - Custom shader material from extend() */}
        <buildingBoundsMaterial
          // blending={AdditiveBlending}
          color={'#d2d1f5'}
          depthWrite={false}
          opacity={0.25}
          ref={materialRef}
          side={DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  )
})

const BuildingBoundsMaterial = shaderMaterial(
  {
    color: new Color('white'),
    opacity: 1.0,
    lifetime: 0,
    uTime: 0,
  },
  /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,
  /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  uniform vec3 color;
  uniform float opacity;
  uniform float uTime;
  uniform float lifetime;
  void main() {
      // Hide top and bottom faces based on world position
      // Box is centered at Y=5.2 with height 10, so top is at 10.2 and bottom is at 0.2
      float threshold = 0.1;
      if (vWorldPosition.y < (0.2 + threshold) || vWorldPosition.y > (10.2 - threshold)) {
        discard;
      }

      float transitionSpeed = 0.4;
      float alpha = opacity * smoothstep(0.0, transitionSpeed, lifetime);
      vec3 finalColor = color;

      // Make bottom edge (0 to 0.22) very strong
      float bottomStrength = smoothstep(0.22, 0.0, vUv.y);
      float baseAlpha = smoothstep(1.0, 0.0, vUv.y);

      // Boost color intensity at bottom
      finalColor = mix(finalColor, finalColor * 2.0, bottomStrength);

      // Calculate correct aspect ratio: box is 30 wide x 10 tall
      float aspectRatio = 30.0 / 10.0; // GRID_SIZE / height

      vec2 centeredUv = (vUv * 2.0) - 1.0;
      centeredUv.x *= aspectRatio; // Correct aspect ratio for 1:1 dots
      vec2 gridUv = centeredUv * 10.0; // Number of dots along the shorter axis (height)

      // Get fractional part to create repeating grid
      vec2 grid = fract(gridUv);

      // Move to center of each grid cell (center at 0.5, 0.5)
      vec2 cellCenter = grid - 0.5;

      // Calculate distance from current point to cell center
      float dist = length(cellCenter);

      // Create circular dots with a smooth edge
      float dotSize = 0.35; // Adjust for dot size
      float dotsTexture = max(0.5, smoothstep(dotSize + 0.01, dotSize - 0.01, dist));

      alpha *= mix(dotsTexture, 1.0, smoothstep(0.8, 1.0, vUv.y));
      alpha *= baseAlpha;

      // Boost alpha at bottom edge
      alpha = mix(alpha, 1.0, bottomStrength * 0.5);

      gl_FragColor = vec4(finalColor, alpha);
  }
`,
)

extend({ BuildingBoundsMaterial })

BuildingRenderer.displayName = 'BuildingRenderer'
