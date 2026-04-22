import { getScaledDimensions, type ItemNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, type Group, MathUtils, type Mesh, Vector3 } from 'three'
import {
  applyEnergyWaveShieldUniforms,
  createEnergyWaveShieldMaterial,
  DEFAULT_ENERGY_WAVE_SHIELD_SETTINGS,
  ENERGY_WAVE_FADE_HEIGHT_METERS,
  ENERGY_WAVE_FULL_EFFECT_HEIGHT_METERS,
  type EnergyWaveShieldSettings,
} from '../../../lib/energy-wave-shield'
import { useScifiShieldNoiseTexture } from '../../../lib/scifi-shield'

const REPAIR_ITEM_SHIELD_FADE_IN_MS = 1000
const REPAIR_ITEM_SHIELD_FADE_OUT_MS = 500
const REPAIR_ITEM_SHIELD_HEIGHT_TRANSITION_MS = 1500
const ENERGY_WAVE_HIDDEN_EPSILON = 0.01

export type ItemRepairEnergyWaveProps = {
  activatedAtMs: number
  assetOffset: [number, number, number]
  assetRotation: [number, number, number]
  effectFadeHeightRatio?: number
  effectFullHeightRatio?: number
  modelScene: Group
  node: ItemNode
  onHidden?: (() => void) | undefined
  renderScale: [number, number, number]
  settings?: EnergyWaveShieldSettings
  visible?: boolean
  fadeInMs?: number
  fadeOutMs?: number
}

export function ItemRepairEnergyWave({
  activatedAtMs,
  assetOffset,
  assetRotation,
  effectFadeHeightRatio,
  effectFullHeightRatio,
  fadeInMs = REPAIR_ITEM_SHIELD_FADE_IN_MS,
  fadeOutMs = REPAIR_ITEM_SHIELD_FADE_OUT_MS,
  modelScene,
  node,
  onHidden,
  renderScale,
  settings = DEFAULT_ENERGY_WAVE_SHIELD_SETTINGS,
  visible = true,
}: ItemRepairEnergyWaveProps) {
  const [, fallbackHeight] = getScaledDimensions(node)
  const noiseTexture = useScifiShieldNoiseTexture()
  const fadeProgressRef = useRef(0)
  const heightProgressRef = useRef(0)
  const hiddenNotifiedRef = useRef(false)
  const timeRef = useRef(0)
  const overlayRef = useRef<Group>(null)
  const boundsRef = useRef(new Box3())
  const boundsFallbackCenterRef = useRef(new Vector3())
  const overlayScene = useMemo(() => modelScene.clone(true) as Group, [modelScene])
  const material = useMemo(() => {
    const nextMaterial = createEnergyWaveShieldMaterial(noiseTexture, settings)
    nextMaterial.uniforms.uOpacity.value = 0
    return nextMaterial
  }, [noiseTexture, settings])

  const { bottomY, topY } = useMemo(() => {
    const boundsSource = overlayScene.clone(true) as Group
    boundsSource.position.set(assetOffset[0], assetOffset[1], assetOffset[2])
    boundsSource.rotation.set(assetRotation[0], assetRotation[1], assetRotation[2])
    boundsSource.scale.set(renderScale[0], renderScale[1], renderScale[2])
    boundsSource.updateWorldMatrix(true, true)
    const bounds = new Box3().setFromObject(boundsSource)
    if (Number.isFinite(bounds.min.y) && Number.isFinite(bounds.max.y)) {
      return {
        bottomY: bounds.min.y,
        topY: bounds.max.y,
      }
    }

    const fallbackBottom = assetOffset[1]
    return {
      bottomY: fallbackBottom,
      topY: fallbackBottom + fallbackHeight * renderScale[1],
    }
  }, [assetOffset, assetRotation, fallbackHeight, overlayScene, renderScale])

  useMemo(() => {
    overlayScene.traverse((child) => {
      if (!(child as Mesh).isMesh) {
        return
      }

      const mesh = child as Mesh
      mesh.castShadow = false
      mesh.frustumCulled = false
      mesh.material = material
      mesh.receiveShadow = false
      mesh.renderOrder = 3
      mesh.userData.pascalExcludeFromOutline = true
    })
  }, [material, overlayScene])

  useEffect(() => {
    applyEnergyWaveShieldUniforms(material.uniforms, settings)
    material.uniforms.uBottomY.value = bottomY
    material.uniforms.uTopY.value = topY
    material.uniforms.uNoiseTexture.value = noiseTexture
  }, [bottomY, material, noiseTexture, settings, topY])

  useEffect(() => {
    fadeProgressRef.current = 0
    heightProgressRef.current = 0
    hiddenNotifiedRef.current = false
    timeRef.current = 0
    material.uniforms.uOpacity.value = 0
    material.uniforms.uEffectFullHeight.value = 0
    material.uniforms.uEffectFadeHeight.value = 0
  }, [activatedAtMs, material])

  useEffect(() => {
    if (visible) {
      hiddenNotifiedRef.current = false
    }
  }, [visible])

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.1)
    timeRef.current += clampedDelta
    material.uniforms.uTime.value = timeRef.current

    const overlayObject = overlayRef.current
    if (overlayObject) {
      overlayObject.updateWorldMatrix(true, true)
      const bounds = boundsRef.current.setFromObject(overlayObject)
      if (Number.isFinite(bounds.min.y) && Number.isFinite(bounds.max.y)) {
        material.uniforms.uBottomY.value = bounds.min.y
        material.uniforms.uTopY.value = bounds.max.y
      } else {
        boundsFallbackCenterRef.current.set(assetOffset[0], assetOffset[1], assetOffset[2])
        boundsFallbackCenterRef.current.applyMatrix4(
          overlayObject.parent?.matrixWorld ?? overlayObject.matrixWorld,
        )
        material.uniforms.uBottomY.value = boundsFallbackCenterRef.current.y
        material.uniforms.uTopY.value =
          boundsFallbackCenterRef.current.y + fallbackHeight * renderScale[1]
      }
    }

    const targetProgress = visible ? 1 : 0
    const fadeDurationSeconds = (visible ? fadeInMs : fadeOutMs) / 1000 || Number.EPSILON
    fadeProgressRef.current = MathUtils.clamp(
      fadeProgressRef.current +
        Math.sign(targetProgress - fadeProgressRef.current) * (delta / fadeDurationSeconds),
      0,
      1,
    )
    const nextVisibility = MathUtils.smootherstep(fadeProgressRef.current, 0, 1)
    const heightDurationSeconds = REPAIR_ITEM_SHIELD_HEIGHT_TRANSITION_MS / 1000 || Number.EPSILON
    heightProgressRef.current = MathUtils.clamp(
      heightProgressRef.current +
        Math.sign(targetProgress - heightProgressRef.current) * (delta / heightDurationSeconds),
      0,
      1,
    )
    const nextHeightVisibility = MathUtils.smootherstep(heightProgressRef.current, 0, 1)
    const targetEffectFullHeight = effectFullHeightRatio ?? ENERGY_WAVE_FULL_EFFECT_HEIGHT_METERS
    const targetEffectFadeHeight = effectFadeHeightRatio ?? ENERGY_WAVE_FADE_HEIGHT_METERS

    material.uniforms.uOpacity.value = settings.opacity * nextVisibility
    material.uniforms.uEffectFullHeight.value = targetEffectFullHeight * nextHeightVisibility
    material.uniforms.uEffectFadeHeight.value = targetEffectFadeHeight * nextHeightVisibility

    if (!visible && !hiddenNotifiedRef.current && nextVisibility <= ENERGY_WAVE_HIDDEN_EPSILON) {
      hiddenNotifiedRef.current = true
      onHidden?.()
    }
  })

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

  return (
    <primitive
      object={overlayScene}
      ref={overlayRef}
      position={assetOffset}
      rotation={assetRotation}
      scale={renderScale}
    />
  )
}
