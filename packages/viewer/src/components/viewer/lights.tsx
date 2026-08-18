import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js'
import type { AmbientLight, DirectionalLight, HemisphereLight } from 'three/webgpu'
import * as THREE from 'three/webgpu'
import { SHADOW_ONLY_LAYER } from '../../lib/layers'
import { getSceneTheme } from '../../lib/scene-themes'
import useViewer from '../../store/use-viewer'

// Diagnostic toggle: `?disable=shadows` skips the shadow-map render pass
const SHADOWS_DISABLED =
  typeof window !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search).get('disable') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('shadows')

const MAX_SHADOW_INTENSITY = 0.75

// With CSM, resolution is much higher per cascade, so we can use much smaller bias
// or rely completely on thickness. We use a tiny bias to prevent acne.
const SHADOW_DEPTH_BIAS = -0.0001
const SHADOW_NORMAL_BIAS = 0.02

export function Lights() {
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const theme = getSceneTheme(sceneTheme)
  const shadows = useViewer((state) => state.shadows)
  const graphicsQuality = useViewer((state) => state.graphicsQuality)

  const lightRefs = useRef<Array<DirectionalLight | null>>([])
  const csmRefs = useRef<Array<any | null>>([])

  const shadowDir = useRef(new THREE.Vector3())

  const hemiRef = useRef<HemisphereLight>(null)
  const ambientRef = useRef<AmbientLight>(null)

  const initialized = useRef(false)
  const lightTargets = useRef<THREE.Color[]>([])

  const targets = useMemo(
    () => ({
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      ambColor: new THREE.Color(),
    }),
    [],
  )

  useEffect(() => {
    if (SHADOWS_DISABLED) return

    const cascades = graphicsQuality === 'low' ? 2 : graphicsQuality === 'medium' ? 3 : 4
    const maxFar = graphicsQuality === 'low' ? 100 : graphicsQuality === 'medium' ? 200 : 400
    const mapSize = graphicsQuality === 'high' ? 2048 : 1024

    theme.lights.forEach((config, index) => {
      const light = lightRefs.current[index]
      if (light && config.castShadow) {
        const oldCsm = csmRefs.current[index]
        if (oldCsm) oldCsm.dispose()

        light.shadow.mapSize.set(mapSize, mapSize)
        light.shadow.bias = SHADOW_DEPTH_BIAS
        light.shadow.normalBias = SHADOW_NORMAL_BIAS

        const csm = new CSMShadowNode(light, {
          cascades,
          maxFar,
          mode: 'practical',
        })
        ;(light.shadow as any).shadowNode = csm
        csmRefs.current[index] = csm
      }
    })

    return () => {
      csmRefs.current.forEach((csm) => {
        if (csm) csm.dispose()
      })
      csmRefs.current = []
    }
  }, [graphicsQuality, theme.lights])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1) * 4

    if (shadows) {
      const sun = useViewer.getState().sunDirection

      for (let index = 0; index < theme.lights.length; index++) {
        const config = theme.lights[index]
        const light = lightRefs.current[index]
        if (!(config?.castShadow && light)) continue

        const [ox, oy, oz] = sun ?? config.position
        const dir = shadowDir.current.set(ox, oy, oz)
        if (dir.lengthSq() === 0) dir.set(0, 1, 0)
        dir.normalize().multiplyScalar(100)

        light.position.copy(state.camera.position).add(dir)
        light.target.position.copy(state.camera.position)
        light.target.updateMatrixWorld()

        const csm = csmRefs.current[index]
        if (csm) {
          if (csm.camera) {
            csm.updateFrustums()
            csm.lights.forEach((lwLight: any) => {
              if (lwLight.shadow?.camera) {
                lwLight.shadow.camera.layers.enable(SHADOW_ONLY_LAYER)
              }
            })
          }
        }
      }
    }

    if (!initialized.current) {
      for (let index = 0; index < theme.lights.length; index++) {
        const config = theme.lights[index]
        const light = lightRefs.current[index]
        if (!(config && light)) continue
        light.intensity = config.intensity
        light.color.set(config.color)

        if (config.castShadow && light.shadow) {
          light.shadow.intensity = config.intensity <= 1 ? config.intensity : MAX_SHADOW_INTENSITY
        }
      }
      if (hemiRef.current && theme.hemi) {
        hemiRef.current.intensity = theme.hemi.intensity
        hemiRef.current.color.set(theme.hemi.sky)
        hemiRef.current.groundColor.set(theme.hemi.ground)
      }
      if (ambientRef.current) {
        ambientRef.current.intensity = theme.ambient.intensity
        ambientRef.current.color.set(theme.ambient.color)
      }
      initialized.current = true
      return
    }

    for (let index = 0; index < theme.lights.length; index++) {
      const config = theme.lights[index]
      const light = lightRefs.current[index]
      if (!(config && light)) continue

      light.intensity = THREE.MathUtils.lerp(light.intensity, config.intensity, dt)
      let target = lightTargets.current[index]
      if (!target) {
        target = new THREE.Color()
        lightTargets.current[index] = target
      }
      target.set(config.color)
      light.color.lerp(target, dt)

      if (config.castShadow && light.shadow) {
        if (light.shadow.intensity !== undefined) {
          light.shadow.intensity = THREE.MathUtils.lerp(
            light.shadow.intensity,
            config.intensity <= 1 ? config.intensity : MAX_SHADOW_INTENSITY,
            dt,
          )
        }
      }
    }

    if (hemiRef.current && theme.hemi) {
      hemiRef.current.intensity = THREE.MathUtils.lerp(
        hemiRef.current.intensity,
        theme.hemi.intensity,
        dt,
      )
      targets.hemiSky.set(theme.hemi.sky)
      hemiRef.current.color.lerp(targets.hemiSky, dt)
      targets.hemiGround.set(theme.hemi.ground)
      hemiRef.current.groundColor.lerp(targets.hemiGround, dt)
    }

    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(
        ambientRef.current.intensity,
        theme.ambient.intensity,
        dt,
      )
      targets.ambColor.set(theme.ambient.color)
      ambientRef.current.color.lerp(targets.ambColor, dt)
    }
  })

  return (
    <>
      {theme.lights.map((light, index) => (
        <directionalLight
          castShadow={Boolean(light.castShadow) && !SHADOWS_DISABLED}
          key={`${index}-${light.position.join(',')}`}
          position={light.position}
          ref={(ref) => {
            lightRefs.current[index] = ref
          }}
        />
      ))}

      {theme.hemi ? <hemisphereLight ref={hemiRef} /> : null}

      <ambientLight ref={ambientRef} />
    </>
  )
}
