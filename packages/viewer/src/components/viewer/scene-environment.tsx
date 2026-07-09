'use client'

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three/webgpu'
import { getSceneTheme } from '../../lib/scene-themes'
import useViewer from '../../store/use-viewer'

/**
 * Scene IBL — a small procedural gradient sky (cool zenith → warm horizon →
 * dim ground bounce) used purely as the environment light source. The visible
 * backdrop stays the flat theme background (composited in post-processing);
 * this texture is never shown. Replaces the old `venice_sunset_1k.hdr` fetch:
 * no network dependency, and the vertical color split means upward-facing
 * surfaces read cooler than vertical ones instead of everything getting the
 * same directionless warm wash. Exported as an opt-in <Viewer> child so
 * embed / thumbnail surfaces that don't want IBL simply don't mount it.
 * Only affects `rendered` shading (Lambert ignores env maps).
 */

// Linear-space gradient stops.
const ZENITH = [0.4, 0.56, 0.78] as const
const HORIZON = [0.95, 0.84, 0.66] as const
const GROUND = [0.38, 0.35, 0.3] as const

const ENV_INTENSITY = 0.6
// The gradient sky is a daylight source; dark themes only want a whisper of it.
const ENV_INTENSITY_DARK = 0.2
const WIDTH = 64
const HEIGHT = 32

function buildGradientSky(): THREE.DataTexture {
  const data = new Float32Array(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y++) {
    // Row 0 = v0 = nadir, top row = zenith (equirect v spans -90°..+90°).
    const lat = ((y + 0.5) / HEIGHT) * 2 - 1
    let r: number
    let g: number
    let b: number
    if (lat <= 0) {
      // Below the horizon: flat ground bounce, slightly darker toward nadir.
      const k = 1 + lat * 0.35
      r = GROUND[0] * k
      g = GROUND[1] * k
      b = GROUND[2] * k
    } else {
      // pow < 1 widens the warm horizon band.
      const t = lat ** 0.65
      r = HORIZON[0] + (ZENITH[0] - HORIZON[0]) * t
      g = HORIZON[1] + (ZENITH[1] - HORIZON[1]) * t
      b = HORIZON[2] + (ZENITH[2] - HORIZON[2]) * t
    }
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 1
    }
  }
  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.FloatType)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export function SceneEnvironment() {
  const scene = useThree((state) => state.scene)
  const texture = useMemo(buildGradientSky, [])
  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)

  useEffect(() => {
    const prevEnvironment = scene.environment
    const prevIntensity = scene.environmentIntensity
    scene.environment = texture
    scene.environmentIntensity = appearance === 'dark' ? ENV_INTENSITY_DARK : ENV_INTENSITY
    return () => {
      scene.environment = prevEnvironment
      scene.environmentIntensity = prevIntensity
      texture.dispose()
    }
  }, [scene, texture, appearance])

  return null
}
