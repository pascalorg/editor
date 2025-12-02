'use client'

import { FrontSide, MeshPhysicalMaterial } from 'three'
import CustomShaderMaterial from 'three-custom-shader-material'

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
      position={[0, -0.01, 0]}
      raycast={() => null}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      <CustomShaderMaterial
        baseMaterial={MeshPhysicalMaterial}
        color={FLOOR_COLOR}
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
        transparent // Your vertex Shader
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
  return {
    fadeDistance: FADE_DISTANCE,
    fadeStrength: FADE_STRENGTH,
  }
}
