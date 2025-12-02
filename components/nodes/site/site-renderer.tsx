'use client'

import { Html, shaderMaterial } from '@react-three/drei'
import { extend, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { DoubleSide } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { GRID_SIZE, TILE_SIZE } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import type { SiteNode } from '@/lib/scenegraph/schema/index'

interface SiteRendererProps {
  nodeId: SiteNode['id']
}

/**
 * Site renderer component
 * Renders the property line polygon and handles for editing
 */
export const SiteRenderer = memo(({ nodeId }: SiteRendererProps) => {
  const materialRef = useRef<any>(null)
  const groupRef = useRef<THREE.Group>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const { camera } = useThree()

  const { polygon, isSelected } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as SiteNode
      return {
        polygon: node?.polygon,
        isSelected: state.selectedNodeIds.includes(nodeId),
      }
    }),
  )

  const updateNode = useEditor((state) => state.updateNode)

  // Default points if not present (fallback)
  const points = useMemo(() => {
    if (polygon?.points && polygon.points.length > 0) {
      return polygon.points
    }
    // Fallback to default square matching GRID_SIZE
    return [
      [0, 0],
      [GRID_SIZE, 0],
      [GRID_SIZE, GRID_SIZE],
      [0, GRID_SIZE],
    ] as [number, number][]
  }, [polygon])

  useFrame(({ clock }, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = clock.elapsedTime
      materialRef.current.lifetime += delta
    }
  })

  // Create geometry from points
  const geometry = useMemo(() => {
    if (points.length < 3) return null

    // Create shape (negate Z for correct orientation when rotated)
    const shapePoints = points.map(([x, y]) => new THREE.Vector2(x, -y))
    const shape = new THREE.Shape(shapePoints)

    const extrudeSettings = {
      depth: 10, // Height of the volume
      bevelEnabled: false,
    }

    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings)
    // Rotate to align with world (XY -> XZ)
    geom.rotateX(-Math.PI / 2)

    // ExtrudeGeometry creates UVs, but we'll use world position in shader
    return geom
  }, [points])

  // Drag handlers
  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>, index: number) => {
    e.stopPropagation()
    // Only left click
    if (e.button !== 0) return

    setDraggingIndex(index)
    const el = e.nativeEvent.target as HTMLElement
    el.setPointerCapture?.(e.pointerId)
  }, [])

  const onPointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setDraggingIndex(null)
    const el = e.nativeEvent.target as HTMLElement
    el.releasePointerCapture?.(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (draggingIndex === null || !groupRef.current) return
      e.stopPropagation()

      // Convert world point to local space
      const worldPoint = e.point.clone()
      const localPoint = groupRef.current.worldToLocal(worldPoint)

      // Snap to grid (0.5m)
      const snap = TILE_SIZE
      const x = Math.round(localPoint.x / snap) * snap
      const z = Math.round(localPoint.z / snap) * snap

      // Update points
      const newPoints = [...points]
      newPoints[draggingIndex] = [x, z]

      updateNode(nodeId, {
        polygon: {
          type: 'polygon',
          points: newPoints,
        },
      })
    },
    [draggingIndex, points, updateNode, nodeId],
  )

  // Drag plane (invisible) to catch move events when dragging
  const dragPlane = useMemo(
    () => (
      <mesh
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial color="red" depthWrite={false} opacity={0} transparent />
      </mesh>
    ),
    [onPointerMove, onPointerUp],
  )

  if (!geometry) return null

  return (
    <group ref={groupRef}>
      <mesh
        geometry={geometry}
        // Position offset: The extrusion starts at Z=0 (local) which becomes Y=0 (world)
        // We want it slightly raised? Or at 0?
        // Existing was at 5.2 (center) with height 10 => 0.2 to 10.2
        // Extrusion of 10 at Y=0 goes 0 to 10.
        // Let's put it at 0.2 to avoid Z-fighting with floor if needed, or 0.
        position={[0, 0.2, 0]}
      >
        {/* @ts-expect-error - Custom shader material from extend() */}
        <siteBoundsMaterial
          color={'#d2d1f5'}
          depthWrite={false}
          opacity={0.35}
          ref={materialRef}
          side={DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>

      {/* Handles */}
      {isSelected && (
        <>
          {points.map(([x, y], i) => (
            <mesh
              key={i}
              onPointerDown={(e) => onPointerDown(e, i)} // Slightly above ground
              position={[x, 0.5, y]}
              renderOrder={10}
            >
              <sphereGeometry args={[0.3, 16, 16]} />
              <meshBasicMaterial
                color={draggingIndex === i ? 'yellow' : 'white'}
                depthTest={false}
                transparent
              />
            </mesh>
          ))}
          {/* Active dragging plane */}
          {draggingIndex !== null && dragPlane}
        </>
      )}
    </group>
  )
})

const SiteBoundsMaterial = shaderMaterial(
  {
    color: new THREE.Color('white'),
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

  // Simple 2D noise function
  float noise(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Smooth noise
  float smoothNoise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    // Four corners in 2D of a tile
    float a = noise(i);
    float b = noise(i + vec2(1.0, 0.0));
    float c = noise(i + vec2(0.0, 1.0));
    float d = noise(i + vec2(1.0, 1.0));

    // Smooth interpolation
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

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
      // Use world height relative to base (0.2)
      float relHeight = vWorldPosition.y - 0.2;
      float heightNorm = clamp(relHeight / 10.0, 0.0, 1.0);
      
      float bottomStrength = smoothstep(0.05, 0.0, heightNorm); // Strong at bottom
      float baseAlpha = smoothstep(1.0, 0.0, heightNorm); // Fade out going up

      // Boost color intensity at bottom
      finalColor = mix(finalColor, finalColor * 2.0, bottomStrength);

      // Use world position for dots pattern to be independent of geometry UVs
      vec2 gridUv = vWorldPosition.xz * 2.0; // 2 dots per unit (approx 50cm spacing)

      // Get fractional part to create repeating grid
      vec2 grid = fract(gridUv);

      // Move to center of each grid cell (center at 0.5, 0.5)
      vec2 cellCenter = grid - 0.5;

      // Calculate distance from current point to cell center
      float dist = length(cellCenter);

      // Create circular dots with a smooth edge
      float dotSize = 0.25; // Adjust for dot size
      float dotsTexture = max(0.5, smoothstep(dotSize + 0.01, dotSize - 0.01, dist));

      // Fade dots at both top and bottom
      float dotsFade = max(smoothstep(0.8, 1.0, heightNorm), bottomStrength);
      alpha *= mix(dotsTexture, 1.0, dotsFade);
      alpha *= baseAlpha;

      // Boost alpha at bottom edge
      alpha = mix(alpha, 1.0, bottomStrength * 0.5);

      // Add animated noise to transparency
      vec2 noiseCoord = vWorldPosition.xz * 0.05 + uTime * 0.5;
      float noiseValue = smoothNoise(noiseCoord);

      // Layer multiple octaves for more interesting movement
      noiseValue += smoothNoise(noiseCoord * 2.0 - uTime * 0.15) * 0.5;
      noiseValue += smoothNoise(noiseCoord * 4.0 + uTime * 0.08) * 0.25;
      noiseValue /= 1.75; // Normalize

      // Apply noise to alpha (subtle effect)
      alpha *= mix(0.1, 1.0, noiseValue);

      gl_FragColor = vec4(finalColor, alpha);
  }
`,
)

extend({ SiteBoundsMaterial })

SiteRenderer.displayName = 'SiteRenderer'
