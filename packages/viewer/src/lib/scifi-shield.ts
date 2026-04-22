import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  NormalBlending,
  RepeatWrapping,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import {
  acos,
  cameraPosition,
  dot,
  equirectUV,
  float,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  texture as textureNode,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'

export const SCIFI_SHIELD_NOISE_TEXTURE_URL = '/textures/carried-bubble-cloud-noise-v1.png'

export type ScifiShieldSettings = {
  centerBandHeight: number
  centerVisibility: number
  fresnelPower: number
  hitColor: string
  hitPositionX: number
  hitPositionY: number
  hitPositionZ: number
  hitProgress: number
  hitPushForce: number
  hitRadius: number
  hitRingWidth: number
  shieldBrightness: number
  shieldColor: string
  shieldOpacity: number
  waveHeight: number
  waveSpeedX: number
  waveSpeedY: number
}

export const DEFAULT_SCIFI_SHIELD_SETTINGS: ScifiShieldSettings = {
  centerBandHeight: 0.365,
  centerVisibility: 0.51,
  fresnelPower: 0.5,
  hitColor: '#f4fbff',
  hitPositionX: -1,
  hitPositionY: -1,
  hitPositionZ: -1,
  hitProgress: 0,
  hitPushForce: 0,
  hitRadius: 0,
  hitRingWidth: 0,
  shieldBrightness: 0.65,
  shieldColor: '#c2bb00',
  shieldOpacity: 0.91,
  waveHeight: 0.105,
  waveSpeedX: 0.005,
  waveSpeedY: 0.005,
}

useLoader.preload(TextureLoader, SCIFI_SHIELD_NOISE_TEXTURE_URL)

function prepareScifiShieldNoiseTexture(texture: Texture) {
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.colorSpace = NoColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.needsUpdate = true
  return texture
}

export function useScifiShieldNoiseTexture() {
  const texture = useLoader(TextureLoader, SCIFI_SHIELD_NOISE_TEXTURE_URL) as Texture

  return useMemo(() => prepareScifiShieldNoiseTexture(texture), [texture])
}

export const ITEM_REPAIR_SHIELD_SETTINGS: ScifiShieldSettings = {
  centerBandHeight: 0.365,
  centerVisibility: 0.51,
  fresnelPower: 0.5,
  hitColor: '#f4fbff',
  hitPositionX: -1,
  hitPositionY: -1,
  hitPositionZ: -1,
  hitProgress: 0,
  hitPushForce: 0,
  hitRadius: 0,
  hitRingWidth: 0,
  shieldBrightness: 0.65,
  shieldColor: '#c2bb00',
  shieldOpacity: 0.91,
  waveHeight: 0.105,
  waveSpeedX: 0.005,
  waveSpeedY: 0.005,
}

export type ScifiShieldMaterialUniforms = {
  uPascalShieldVisibility: { value: number } & any
  uPascalShieldCenterBandHeight: { value: number } & any
  uPascalShieldBrightness: { value: number } & any
  uPascalShieldCenterVisibility: { value: number } & any
  uPascalShieldFresnelPower: { value: number } & any
  uPascalShieldHitColor: { value: Color } & any
  uPascalShieldHitPosition: { value: Vector3 } & any
  uPascalShieldHitProgress: { value: number } & any
  uPascalShieldHitPushForce: { value: number } & any
  uPascalShieldHitRadius: { value: number } & any
  uPascalShieldHitRingWidth: { value: number } & any
  uPascalShieldOpacity: { value: number } & any
  uPascalShieldColor: { value: Color } & any
  uPascalShieldTime: { value: number } & any
  uPascalShieldWaveHeight: { value: number } & any
  uPascalShieldWaveSpeed: { value: Vector2 } & any
}

export type ScifiShieldMaterial = MeshBasicNodeMaterial & {
  userData: MeshBasicNodeMaterial['userData'] & {
    pascalScifiShieldUniforms?: ScifiShieldMaterialUniforms
  }
}

export function getScifiShieldMaterialUniforms(material: ScifiShieldMaterial) {
  return material.userData.pascalScifiShieldUniforms ?? null
}

function createScifiShieldUniforms(settings: ScifiShieldSettings): ScifiShieldMaterialUniforms {
  return {
    uPascalShieldVisibility: uniform(1) as ScifiShieldMaterialUniforms['uPascalShieldVisibility'],
    uPascalShieldCenterBandHeight: uniform(
      settings.centerBandHeight,
    ) as ScifiShieldMaterialUniforms['uPascalShieldCenterBandHeight'],
    uPascalShieldBrightness: uniform(
      settings.shieldBrightness,
    ) as ScifiShieldMaterialUniforms['uPascalShieldBrightness'],
    uPascalShieldCenterVisibility: uniform(
      settings.centerVisibility,
    ) as ScifiShieldMaterialUniforms['uPascalShieldCenterVisibility'],
    uPascalShieldFresnelPower: uniform(
      settings.fresnelPower,
    ) as ScifiShieldMaterialUniforms['uPascalShieldFresnelPower'],
    uPascalShieldHitColor: uniform(
      new Color(settings.hitColor),
    ) as ScifiShieldMaterialUniforms['uPascalShieldHitColor'],
    uPascalShieldHitPosition: uniform(
      new Vector3(settings.hitPositionX, settings.hitPositionY, settings.hitPositionZ),
    ) as ScifiShieldMaterialUniforms['uPascalShieldHitPosition'],
    uPascalShieldHitProgress: uniform(
      settings.hitProgress,
    ) as ScifiShieldMaterialUniforms['uPascalShieldHitProgress'],
    uPascalShieldHitPushForce: uniform(
      settings.hitPushForce,
    ) as ScifiShieldMaterialUniforms['uPascalShieldHitPushForce'],
    uPascalShieldHitRadius: uniform(
      settings.hitRadius,
    ) as ScifiShieldMaterialUniforms['uPascalShieldHitRadius'],
    uPascalShieldHitRingWidth: uniform(
      settings.hitRingWidth,
    ) as ScifiShieldMaterialUniforms['uPascalShieldHitRingWidth'],
    uPascalShieldOpacity: uniform(
      settings.shieldOpacity,
    ) as ScifiShieldMaterialUniforms['uPascalShieldOpacity'],
    uPascalShieldColor: uniform(
      new Color(settings.shieldColor),
    ) as ScifiShieldMaterialUniforms['uPascalShieldColor'],
    uPascalShieldTime: uniform(0) as ScifiShieldMaterialUniforms['uPascalShieldTime'],
    uPascalShieldWaveHeight: uniform(
      settings.waveHeight,
    ) as ScifiShieldMaterialUniforms['uPascalShieldWaveHeight'],
    uPascalShieldWaveSpeed: uniform(
      new Vector2(settings.waveSpeedX, settings.waveSpeedY),
    ) as ScifiShieldMaterialUniforms['uPascalShieldWaveSpeed'],
  }
}

export function applyScifiShieldUniforms(
  uniforms: ScifiShieldMaterialUniforms,
  settings: ScifiShieldSettings,
) {
  uniforms.uPascalShieldCenterBandHeight.value = settings.centerBandHeight
  uniforms.uPascalShieldBrightness.value = settings.shieldBrightness
  uniforms.uPascalShieldCenterVisibility.value = settings.centerVisibility
  uniforms.uPascalShieldFresnelPower.value = settings.fresnelPower
  uniforms.uPascalShieldHitColor.value.set(settings.hitColor)
  uniforms.uPascalShieldHitPosition.value.set(
    settings.hitPositionX,
    settings.hitPositionY,
    settings.hitPositionZ,
  )
  uniforms.uPascalShieldHitProgress.value = settings.hitProgress
  uniforms.uPascalShieldHitPushForce.value = settings.hitPushForce
  uniforms.uPascalShieldHitRadius.value = settings.hitRadius
  uniforms.uPascalShieldHitRingWidth.value = settings.hitRingWidth
  uniforms.uPascalShieldOpacity.value = settings.shieldOpacity
  uniforms.uPascalShieldColor.value.set(settings.shieldColor)
  uniforms.uPascalShieldWaveHeight.value = settings.waveHeight
  uniforms.uPascalShieldWaveSpeed.value.set(settings.waveSpeedX, settings.waveSpeedY)
}

function createScifiShieldBaseMaterial(settings: ScifiShieldSettings): {
  material: ScifiShieldMaterial
  uniforms: ScifiShieldMaterialUniforms
} {
  // Keep this on the same WebGPU + TSL path as the carried bubble material.
  const material = new MeshBasicNodeMaterial({
    color: '#ffffff',
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    transparent: true,
  }) as ScifiShieldMaterial
  const uniforms = createScifiShieldUniforms(settings)
  material.toneMapped = false
  material.userData.pascalScifiShieldUniforms = uniforms
  return { material, uniforms }
}

function createScifiShieldNodes(noiseTexture: Texture, uniforms: ScifiShieldMaterialUniforms) {
  const shieldVisibility: any = uniforms.uPascalShieldVisibility.clamp(0, 1)
  const shieldLocalNormal: any = normalLocal.normalize()
  // The mesh now contains only the horizontal ring we want to show, so the
  // shader should not apply a second vertical band cut.
  const shieldCenterBand: any = float(1)
  const shieldBaseNoiseUv: any = equirectUV(shieldLocalNormal)
  const noiseUv: any = shieldBaseNoiseUv.add(
    vec2(
      uniforms.uPascalShieldTime.mul(uniforms.uPascalShieldWaveSpeed.x),
      uniforms.uPascalShieldTime.mul(uniforms.uPascalShieldWaveSpeed.y),
    ),
  )
  const noiseSample: any = textureNode(noiseTexture, noiseUv).r
  const baseDisplacement: any = noiseSample
    .sub(float(0.5))
    .mul(2)
    .mul(uniforms.uPascalShieldWaveHeight)
  const hitDirection: any = uniforms.uPascalShieldHitPosition.add(vec3(0, 0.0001, 0)).normalize()
  const impactDistance: any = acos(dot(shieldLocalNormal, hitDirection).clamp(-1, 1))
  const currentRadius: any = uniforms.uPascalShieldHitProgress.mul(uniforms.uPascalShieldHitRadius)
  const distanceToRing: any = impactDistance.sub(currentRadius).abs()
  const hitEnabled: any = smoothstep(float(0.0001), float(0.02), uniforms.uPascalShieldHitProgress)
  const safeHitRingWidth: any = uniforms.uPascalShieldHitRingWidth.max(float(0.0001))
  const hitIntensity: any = smoothstep(safeHitRingWidth, float(0), distanceToRing)
    .mul(float(1).sub(uniforms.uPascalShieldHitProgress))
    .mul(hitEnabled)
    .clamp(0, 1)
  const totalDisplacement: any = baseDisplacement.add(
    hitIntensity.mul(uniforms.uPascalShieldHitPushForce),
  )
  const shieldViewDirection: any = cameraPosition.sub(positionWorld).normalize()
  const fresnelBase: any = float(1).sub(
    dot(normalWorld.normalize(), shieldViewDirection).clamp(0, 1),
  )
  const fresnel: any = pow(fresnelBase, uniforms.uPascalShieldFresnelPower).clamp(0, 1)
  const visibilityMask: any = mix(uniforms.uPascalShieldCenterVisibility, float(1), fresnel).clamp(
    0,
    1,
  )
  const dynamicGlow: any = noiseSample.mul(2).mul(visibilityMask)
  const baseEmission: any = uniforms.uPascalShieldColor.mul(fresnel.mul(2.5).add(dynamicGlow))
  const hitEmission: any = uniforms.uPascalShieldHitColor.mul(hitIntensity.mul(5))
  const shieldSurface: any = uniforms.uPascalShieldColor.mul(visibilityMask.mul(0.18))
  const totalColor: any = shieldSurface
    .add(baseEmission)
    .add(hitEmission)
    .mul(shieldCenterBand)
    .mul(shieldVisibility)
  const baseAlpha: any = fresnel.add(dynamicGlow).clamp(0, 1).mul(uniforms.uPascalShieldOpacity)
  const totalAlpha: any = baseAlpha
    .add(hitIntensity)
    .clamp(0, 1)
    .mul(shieldCenterBand)
    .mul(shieldVisibility)

  return {
    noiseSample,
    shieldCenterBand,
    shieldLocalNormal,
    shieldVisibility,
    totalAlpha,
    totalColor,
    totalDisplacement,
    visibilityMask,
  }
}

export function createScifiShieldMaterial(
  noiseTexture: Texture,
  settings: ScifiShieldSettings = DEFAULT_SCIFI_SHIELD_SETTINGS,
): ScifiShieldMaterial {
  const { material, uniforms } = createScifiShieldBaseMaterial(settings)
  const nodes = createScifiShieldNodes(noiseTexture, uniforms)

  material.blending = NormalBlending
  material.positionNode = positionLocal.add(nodes.shieldLocalNormal.mul(nodes.totalDisplacement))
  material.colorNode = nodes.totalColor.mul(uniforms.uPascalShieldBrightness)
  material.maskNode = nodes.totalAlpha.greaterThan(float(0.001))
  material.opacityNode = nodes.totalAlpha

  return material
}

export function createScifiShieldOccluderMaterial(
  noiseTexture: Texture,
  settings: ScifiShieldSettings = DEFAULT_SCIFI_SHIELD_SETTINGS,
): ScifiShieldMaterial {
  const { material, uniforms } = createScifiShieldBaseMaterial(settings)
  const nodes = createScifiShieldNodes(noiseTexture, uniforms)

  material.colorWrite = false
  material.depthWrite = true
  material.transparent = false
  material.positionNode = positionLocal.add(nodes.shieldLocalNormal.mul(nodes.totalDisplacement))
  material.colorNode = vec3(0)
  material.maskNode = nodes.totalAlpha.greaterThan(float(0.001))
  material.opacityNode = float(1)

  return material
}

export function createScifiShieldBackdropMaterial(
  noiseTexture: Texture,
  settings: ScifiShieldSettings = DEFAULT_SCIFI_SHIELD_SETTINGS,
): ScifiShieldMaterial {
  const { material, uniforms } = createScifiShieldBaseMaterial(settings)
  const nodes = createScifiShieldNodes(noiseTexture, uniforms)
  const backdropColor: any = vec3(0.01).add(nodes.noiseSample.mul(float(0.015)))
  const backdropOpacity: any = nodes.shieldCenterBand
    .mul(nodes.shieldVisibility)
    .mul(nodes.visibilityMask.mul(float(0.14)).add(float(0.1)))
    .clamp(0, 1)

  material.blending = NormalBlending
  material.positionNode = positionLocal.add(
    nodes.shieldLocalNormal.mul(nodes.totalDisplacement.mul(float(0.2))),
  )
  material.colorNode = backdropColor
  material.maskNode = backdropOpacity.greaterThan(float(0.001))
  material.opacityNode = backdropOpacity

  return material
}
