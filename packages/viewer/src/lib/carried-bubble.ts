import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  Color,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  NoColorSpace,
  NormalBlending,
  RepeatWrapping,
  type Texture,
  TextureLoader,
} from 'three'
import {
  cameraPosition,
  dot,
  float,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture as textureNode,
  triplanarTexture,
  uniform,
  vec3,
} from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'

export const CARRIED_BUBBLE_NOISE_TEXTURE_URL = '/textures/carried-bubble-cloud-noise-v1.png'

export type CarriedBubbleSettings = {
  brightness: number
  cloudColor: string
  cloudDriftAmount: number
  cloudMix: number
  cloudThresholdHigh: number
  cloudThresholdLow: number
  cloudWeight: number
  cornerRadius: number
  fieldScale: number
  opacityMax: number
  opacityMin: number
  opacityScale: number
  paddingMax: number
  paddingMin: number
  paddingRatio: number
  pulseAmount: number
  pulseBias: number
  pulseSpeed: number
  rimColor: string
  rimWeight: number
  segments: number
  timeScale: number
}

export const DEFAULT_CARRIED_BUBBLE_SETTINGS: CarriedBubbleSettings = {
  brightness: 0.7,
  cloudColor: '#006eff',
  cloudDriftAmount: 0,
  cloudMix: 1,
  cloudThresholdHigh: 1.11,
  cloudThresholdLow: -0.2,
  cloudWeight: 0,
  cornerRadius: 0.23,
  fieldScale: 0.25,
  opacityMax: 0.97,
  opacityMin: 0,
  opacityScale: 1.5,
  paddingMax: 0.5,
  paddingMin: 0.01,
  paddingRatio: 0,
  pulseAmount: 0.21,
  pulseBias: 0.08,
  pulseSpeed: 2.4,
  rimColor: '#00b4f5',
  rimWeight: 0,
  segments: 2,
  timeScale: 0.9,
}

function prepareCarriedBubbleNoiseTexture(texture: Texture) {
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.colorSpace = NoColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.needsUpdate = true
  return texture
}

export function useCarriedBubbleNoiseTexture() {
  const texture = useLoader(TextureLoader, CARRIED_BUBBLE_NOISE_TEXTURE_URL) as Texture

  return useMemo(() => prepareCarriedBubbleNoiseTexture(texture), [texture])
}

export type CarriedBubbleMaterialUniforms = {
  uPascalBubbleBrightness: { value: number } & any
  uPascalBubbleCloudColor: { value: Color } & any
  uPascalBubbleCloudDriftAmount: { value: number } & any
  uPascalBubbleCloudMix: { value: number } & any
  uPascalBubbleCloudThresholdHigh: { value: number } & any
  uPascalBubbleCloudThresholdLow: { value: number } & any
  uPascalBubbleCloudWeight: { value: number } & any
  uPascalBubbleFieldScale: { value: number } & any
  uPascalBubbleOpacityMax: { value: number } & any
  uPascalBubbleOpacityMin: { value: number } & any
  uPascalBubbleOpacityScale: { value: number } & any
  uPascalBubblePulseAmount: { value: number } & any
  uPascalBubblePulseBias: { value: number } & any
  uPascalBubblePulseSpeed: { value: number } & any
  uPascalBubbleRimColor: { value: Color } & any
  uPascalBubbleRimWeight: { value: number } & any
  uPascalBubbleTime: { value: number } & any
  uPascalBubbleTimeScale: { value: number } & any
  uPascalBubbleVisibility: { value: number } & any
}

export type CarriedBubbleMaterial = MeshBasicNodeMaterial & {
  userData: MeshBasicNodeMaterial['userData'] & {
    pascalBubbleUniforms?: CarriedBubbleMaterialUniforms
  }
}

export type CarriedBubbleBox = {
  bubbleDepth: number
  bubbleHeight: number
  bubbleWidth: number
  padding: number
  radius: number
}

export function getCarriedBubbleUniforms(material: CarriedBubbleMaterial) {
  return material.userData.pascalBubbleUniforms ?? null
}

function createCarriedBubbleUniforms(settings: CarriedBubbleSettings): CarriedBubbleMaterialUniforms {
  return {
    uPascalBubbleBrightness: uniform(
      settings.brightness,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleBrightness'],
    uPascalBubbleCloudColor: uniform(
      new Color(settings.cloudColor),
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleCloudColor'],
    uPascalBubbleCloudDriftAmount: uniform(
      settings.cloudDriftAmount,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleCloudDriftAmount'],
    uPascalBubbleCloudMix: uniform(
      settings.cloudMix,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleCloudMix'],
    uPascalBubbleCloudThresholdHigh: uniform(
      settings.cloudThresholdHigh,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleCloudThresholdHigh'],
    uPascalBubbleCloudThresholdLow: uniform(
      settings.cloudThresholdLow,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleCloudThresholdLow'],
    uPascalBubbleCloudWeight: uniform(
      settings.cloudWeight,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleCloudWeight'],
    uPascalBubbleFieldScale: uniform(
      settings.fieldScale,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleFieldScale'],
    uPascalBubbleOpacityMax: uniform(
      settings.opacityMax,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleOpacityMax'],
    uPascalBubbleOpacityMin: uniform(
      settings.opacityMin,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleOpacityMin'],
    uPascalBubbleOpacityScale: uniform(
      settings.opacityScale,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleOpacityScale'],
    uPascalBubblePulseAmount: uniform(
      settings.pulseAmount,
    ) as CarriedBubbleMaterialUniforms['uPascalBubblePulseAmount'],
    uPascalBubblePulseBias: uniform(
      settings.pulseBias,
    ) as CarriedBubbleMaterialUniforms['uPascalBubblePulseBias'],
    uPascalBubblePulseSpeed: uniform(
      settings.pulseSpeed,
    ) as CarriedBubbleMaterialUniforms['uPascalBubblePulseSpeed'],
    uPascalBubbleRimColor: uniform(
      new Color(settings.rimColor),
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleRimColor'],
    uPascalBubbleRimWeight: uniform(
      settings.rimWeight,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleRimWeight'],
    uPascalBubbleTime: uniform(0) as CarriedBubbleMaterialUniforms['uPascalBubbleTime'],
    uPascalBubbleTimeScale: uniform(
      settings.timeScale,
    ) as CarriedBubbleMaterialUniforms['uPascalBubbleTimeScale'],
    uPascalBubbleVisibility: uniform(1) as CarriedBubbleMaterialUniforms['uPascalBubbleVisibility'],
  }
}

export function applyCarriedBubbleUniforms(
  uniforms: CarriedBubbleMaterialUniforms,
  settings: CarriedBubbleSettings,
) {
  uniforms.uPascalBubbleBrightness.value = settings.brightness
  uniforms.uPascalBubbleCloudColor.value.set(settings.cloudColor)
  uniforms.uPascalBubbleCloudDriftAmount.value = settings.cloudDriftAmount
  uniforms.uPascalBubbleCloudMix.value = settings.cloudMix
  uniforms.uPascalBubbleCloudThresholdHigh.value = settings.cloudThresholdHigh
  uniforms.uPascalBubbleCloudThresholdLow.value = settings.cloudThresholdLow
  uniforms.uPascalBubbleCloudWeight.value = settings.cloudWeight
  uniforms.uPascalBubbleFieldScale.value = settings.fieldScale
  uniforms.uPascalBubbleOpacityMax.value = settings.opacityMax
  uniforms.uPascalBubbleOpacityMin.value = settings.opacityMin
  uniforms.uPascalBubbleOpacityScale.value = settings.opacityScale
  uniforms.uPascalBubblePulseAmount.value = settings.pulseAmount
  uniforms.uPascalBubblePulseBias.value = settings.pulseBias
  uniforms.uPascalBubblePulseSpeed.value = settings.pulseSpeed
  uniforms.uPascalBubbleRimColor.value.set(settings.rimColor)
  uniforms.uPascalBubbleRimWeight.value = settings.rimWeight
  uniforms.uPascalBubbleTimeScale.value = settings.timeScale
}

export function createCarriedBubbleMaterial(
  noiseTexture: Texture,
  settings: CarriedBubbleSettings = DEFAULT_CARRIED_BUBBLE_SETTINGS,
): CarriedBubbleMaterial {
  const material = new MeshBasicNodeMaterial({
    color: '#ffffff',
    depthTest: false,
    depthWrite: false,
    side: FrontSide,
    transparent: true,
  }) as CarriedBubbleMaterial
  const uniforms = createCarriedBubbleUniforms(settings)

  material.blending = NormalBlending
  material.toneMapped = false
  material.userData.pascalBubbleUniforms = uniforms

  const animatedTime: any = uniforms.uPascalBubbleTime.mul(uniforms.uPascalBubbleTimeScale)
  const fieldPosition: any = positionLocal.mul(uniforms.uPascalBubbleFieldScale)
  const cloudNoiseTextureNode: any = textureNode(noiseTexture)
  const cloudWarpTime: any = animatedTime.mul(0.06)
  const cloudWarpSample: any = triplanarTexture(
    cloudNoiseTextureNode,
    null,
    null,
    uniforms.uPascalBubbleFieldScale.mul(0.22),
    positionLocal.add(
      vec3(cloudWarpTime.mul(0.45), cloudWarpTime.mul(-0.32), cloudWarpTime.mul(0.28)),
    ),
    normalLocal,
  ).rgb
  const cloudWarp: any = cloudWarpSample
    .sub(float(0.5))
    .mul(uniforms.uPascalBubbleCloudDriftAmount.mul(1.6))
  const cloudLayerLowPosition: any = positionLocal
    .add(cloudWarp.mul(0.45))
    .add(vec3(animatedTime.mul(0.08), animatedTime.mul(-0.05), animatedTime.mul(0.06)))
  const cloudLayerMidPosition: any = positionLocal
    .mul(1.37)
    .add(cloudWarp.mul(0.8))
    .add(vec3(animatedTime.mul(-0.07), animatedTime.mul(0.09), animatedTime.mul(-0.05)))
    .add(vec3(17.3, -9.1, 5.4))
  const cloudLayerHighPosition: any = positionLocal
    .mul(2.08)
    .add(cloudWarp.mul(1.18))
    .add(vec3(animatedTime.mul(0.11), animatedTime.mul(0.03), animatedTime.mul(-0.09)))
    .add(vec3(-11.8, 6.7, 14.2))
  const cloudNoiseLow: any = triplanarTexture(
    cloudNoiseTextureNode,
    null,
    null,
    uniforms.uPascalBubbleFieldScale.mul(0.4),
    cloudLayerLowPosition,
    normalLocal,
  ).r
  const cloudNoiseMid: any = triplanarTexture(
    cloudNoiseTextureNode,
    null,
    null,
    uniforms.uPascalBubbleFieldScale.mul(0.82),
    cloudLayerMidPosition,
    normalLocal,
  ).r
  const cloudNoiseHigh: any = triplanarTexture(
    cloudNoiseTextureNode,
    null,
    null,
    uniforms.uPascalBubbleFieldScale.mul(1.48),
    cloudLayerHighPosition,
    normalLocal,
  ).r
  const bubbleViewDirection: any = cameraPosition.sub(positionWorld).normalize()
  const bubbleRimBase: any = float(1).sub(
    dot(normalWorld.normalize(), bubbleViewDirection).clamp(0, 1),
  )
  const bubbleRim: any = bubbleRimBase.mul(bubbleRimBase)
  const cloudThresholdLow: any = uniforms.uPascalBubbleCloudThresholdLow
  const cloudThresholdHigh: any = uniforms.uPascalBubbleCloudThresholdHigh
  const bubbleCloudLow: any = smoothstep(
    cloudThresholdLow.sub(0.12),
    cloudThresholdHigh.add(0.04),
    cloudNoiseLow,
  )
  const bubbleCloudMid: any = smoothstep(
    cloudThresholdLow.sub(0.1),
    cloudThresholdHigh.add(0.08),
    cloudNoiseMid.add(bubbleCloudLow.mul(0.12)),
  ).mul(0.92)
  const bubbleCloudHigh: any = smoothstep(
    cloudThresholdLow.sub(0.18),
    cloudThresholdHigh.add(0.12),
    cloudNoiseHigh.add(bubbleCloudMid.mul(0.08)),
  ).mul(0.78)
  const bubbleCloudDensity: any = bubbleCloudLow
    .mul(0.54)
    .add(bubbleCloudMid.mul(0.31))
    .add(bubbleCloudHigh.mul(0.15))
    .clamp(0, 1)
  const bubbleCloudDetail: any = bubbleCloudMid
    .sub(bubbleCloudLow.mul(0.42))
    .add(bubbleCloudHigh.mul(0.68))
    .clamp(0, 1)
  const bubbleFieldBandA: any = sin(
    fieldPosition.y
      .mul(6.35)
      .add(fieldPosition.x.mul(1.72))
      .add(animatedTime.mul(uniforms.uPascalBubblePulseSpeed)),
  )
  const bubbleFieldBandB: any = sin(
    fieldPosition.z
      .mul(5.24)
      .add(fieldPosition.x.mul(-1.08))
      .add(animatedTime.mul(uniforms.uPascalBubblePulseSpeed).mul(-0.78)),
  )
  const bubbleFieldStrength: any = bubbleFieldBandA.mul(bubbleFieldBandB).mul(0.25).add(0.5)
  const bubblePulse: any = sin(
    animatedTime
      .mul(uniforms.uPascalBubblePulseSpeed)
      .add(fieldPosition.x.mul(1.56))
      .add(fieldPosition.y.mul(0.82))
      .add(fieldPosition.z.mul(1.27)),
  )
    .mul(uniforms.uPascalBubblePulseAmount)
    .add(uniforms.uPascalBubblePulseBias)
  const bubbleFieldPulse: any = bubbleFieldStrength.mul(0.14).add(bubblePulse.mul(0.3)).add(0.82)
  const bubbleRimGlow: any = bubbleRim
    .mul(uniforms.uPascalBubbleRimWeight)
    .mul(0.72)
    .mul(bubbleFieldPulse)
  const bubbleCloudGlow: any = bubbleCloudDensity
    .mul(0.88)
    .add(bubbleCloudDetail.mul(0.24))
    .add(bubbleCloudDensity.mul(uniforms.uPascalBubbleCloudWeight).mul(0.18))
  const bubbleCloudShape: any = bubbleCloudDensity
    .mul(0.72)
    .add(bubbleCloudDetail.mul(0.52))
    .sub(bubbleFieldStrength.mul(0.08))
    .add(bubblePulse.mul(0.05))
    .clamp(0, 1)
  const bubbleCloudMask: any = smoothstep(float(0.5), float(0.78), bubbleCloudShape)
  const bubbleRimMask: any = bubbleRimGlow.mul(1.35).clamp(0, 1)
  const bubbleVisibility: any = uniforms.uPascalBubbleVisibility.clamp(0, 1)
  const bubbleOpacityScale: any = uniforms.uPascalBubbleOpacityScale.mul(bubbleVisibility)
  const bubbleOpacityMin: any = uniforms.uPascalBubbleOpacityMin.mul(bubbleVisibility)
  const bubbleOpacityMax: any = uniforms.uPascalBubbleOpacityMax.mul(bubbleVisibility)
  const bubbleCloudAlpha: any = bubbleCloudMask
    .mul(bubbleCloudGlow)
    .mul(uniforms.uPascalBubbleCloudMix.mul(0.5).add(0.5))
  const bubbleRimAlpha: any = bubbleRimMask.mul(0.82)
  const bubbleOpacity: any = bubbleCloudAlpha
    .add(bubbleRimAlpha)
    .mul(bubbleOpacityScale)
    .clamp(bubbleOpacityMin, bubbleOpacityMax)
  const bubbleCloudColor: any = uniforms.uPascalBubbleCloudColor
    .mul(uniforms.uPascalBubbleBrightness)
    .mul(bubbleCloudAlpha.mul(0.92).add(bubbleCloudDetail.mul(bubbleCloudMask).mul(0.14)))
  const bubbleRimColor: any = uniforms.uPascalBubbleRimColor
    .mul(uniforms.uPascalBubbleBrightness)
    .mul(bubbleRimAlpha)

  material.colorNode = bubbleCloudColor.add(bubbleRimColor)
  material.opacityNode = bubbleOpacity
  material.maskNode = bubbleCloudAlpha
    .add(bubbleRimAlpha)
    .mul(bubbleVisibility)
    .greaterThan(float(0.001))

  return material
}

export function getCarriedBubbleBox(
  dimensions: [number, number, number],
  settings: CarriedBubbleSettings,
): CarriedBubbleBox {
  const [width, height, depth] = dimensions
  const largestDimension = Math.max(width, height, depth)
  const padding = MathUtils.clamp(
    largestDimension * settings.paddingRatio,
    settings.paddingMin,
    settings.paddingMax,
  )
  const bubbleWidth = width + padding * 2
  const bubbleHeight = height + padding * 2
  const bubbleDepth = depth + padding * 2
  const radius = Math.min(
    settings.cornerRadius,
    bubbleWidth * 0.25,
    bubbleHeight * 0.25,
    bubbleDepth * 0.25,
  )

  return {
    bubbleDepth,
    bubbleHeight,
    bubbleWidth,
    padding,
    radius,
  }
}
