'use client'

import { useMemo } from 'react'
import { FrontSide, MeshPhysicalMaterial } from 'three'
import CustomShaderMaterial from 'three-custom-shader-material'
import { useShallow } from 'zustand/react/shallow'
import { useEditor } from '@/hooks/use-editor'
import type { SiteNode } from '@/lib/scenegraph/schema/index'
import { GRID_SIZE } from '.'

// Floor material constants
const FLOOR_COLOR = 'white'
const FLOOR_METALNESS = 0.05
const FLOOR_ROUGHNESS = 0.95
const FLOOR_SIZE = 1000

// Grid fade constants
const FADE_DISTANCE = 40
const FADE_STRENGTH = 5

export function InfiniteFloor() {
  return (
    <mesh
      name="infinite-floor"
      position={[0, -0.01, 0]}
      raycast={() => null}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      <CustomShaderMaterial
        baseMaterial={MeshPhysicalMaterial}
        color={FLOOR_COLOR}
        depthWrite={false}
        fragmentShader={
          /* glsl */ `
          varying vec2 vUv;

          void main() {
            float dist = distance(vUv, vec2(0.5));
            csm_DiffuseColor.a = 1.0 - smoothstep(0.0, 0.5, dist);
          }
          `
        }
        metalness={FLOOR_METALNESS}
        roughness={FLOOR_ROUGHNESS}
        vertexShader={
          /* glsl */ `
          varying vec2 vUv;

          void main() {
            vUv = uv;
          }
          `
        } // Your fragment Shader
      />
    </mesh>
  )
}

export function useGridFadeControls() {
  const polygon = useEditor(
    useShallow((state) => {
      const siteHandle = state.graph.getNodesByType('site')[0]
      const siteNode = siteHandle?.data() as SiteNode | undefined
      return siteNode?.polygon
    }),
  )

  const fadeDistance = useMemo(() => {
    if (!polygon?.points || polygon.points.length === 0) return FADE_DISTANCE

    let maxDist = 0
    const offset = GRID_SIZE / 2
    for (const point of polygon.points) {
      // Convert local site coordinates to world coordinates relative to center
      const x = point[0] - offset
      const y = point[1] - offset
      const dist = Math.sqrt(x * x + y * y)
      if (dist > maxDist) maxDist = dist
    }

    // Add buffer of 10m or ensure minimum of default FADE_DISTANCE
    return Math.max(FADE_DISTANCE, maxDist + 15)
  }, [polygon])

  return {
    fadeDistance,
    fadeStrength: FADE_STRENGTH,
  }
}
