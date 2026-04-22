import { AdditiveBlending, Color, DoubleSide, type Texture } from 'three'
import {
  cameraPosition,
  cos,
  dot,
  float,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture as textureNode,
  triplanarTexture,
  uniform,
  uv,
  vec3,
} from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'

export type EnergyWaveShieldSettings = {
  color: string
  colorEdge: string
  edgeWidth: number
  emissionStrength: number
  fadeSoftness: number
  invertTopFade: boolean
  noiseScale: number
  noiseStrength: number
  opacity: number
  riseProgress: number
  timeSpeed: number
  topFadePower: number
  topFadeStart: number
  waveFrequency: number
  waveSpeed: number
  waveTransparency: number
}

export type EnergyWaveShieldUniforms = {
  uBottomY: { value: number } & any
  uColor: { value: Color } & any
  uColorEdge: { value: Color } & any
  uEdgeWidth: { value: number } & any
  uEffectFadeHeight: { value: number } & any
  uEffectFullHeight: { value: number } & any
  uEmissionStrength: { value: number } & any
  uFadeSoftness: { value: number } & any
  uInvertTopFade: { value: number } & any
  uNoiseScale: { value: number } & any
  uNoiseStrength: { value: number } & any
  uNoiseTexture: { value: Texture }
  uOpacity: { value: number } & any
  uRiseProgress: { value: number } & any
  uTime: { value: number } & any
  uTimeSpeed: { value: number } & any
  uTopFadePower: { value: number } & any
  uTopFadeStart: { value: number } & any
  uTopY: { value: number } & any
  uWaveFrequency: { value: number } & any
  uWaveSpeed: { value: number } & any
  uWaveTransparency: { value: number } & any
}

export type EnergyWaveShieldMaterial = MeshBasicNodeMaterial & {
  uniforms: EnergyWaveShieldUniforms
  userData: MeshBasicNodeMaterial['userData'] & {
    pascalEnergyWaveShieldUniforms?: EnergyWaveShieldUniforms
  }
}

export const ENERGY_WAVE_FULL_EFFECT_HEIGHT_METERS = 0.25
export const ENERGY_WAVE_FADE_HEIGHT_METERS = 0.25

export const DEFAULT_ENERGY_WAVE_SHIELD_SETTINGS: EnergyWaveShieldSettings = {
  color: '#0011ff',
  colorEdge: '#3ca220',
  edgeWidth: 0.3,
  emissionStrength: 5.4,
  fadeSoftness: 0.16,
  invertTopFade: true,
  noiseScale: 0.1729,
  noiseStrength: 0,
  opacity: 0.49,
  riseProgress: 0.25,
  timeSpeed: 0.45,
  topFadePower: 1.18,
  topFadeStart: 0.3,
  waveFrequency: 17,
  waveSpeed: 4.25,
  waveTransparency: 1,
}

function createEnergyWaveShieldUniforms(
  noiseTexture: Texture,
  settings: EnergyWaveShieldSettings,
): EnergyWaveShieldUniforms {
  return {
    uBottomY: uniform(0) as EnergyWaveShieldUniforms['uBottomY'],
    uColor: uniform(new Color(settings.color)) as EnergyWaveShieldUniforms['uColor'],
    uColorEdge: uniform(new Color(settings.colorEdge)) as EnergyWaveShieldUniforms['uColorEdge'],
    uEdgeWidth: uniform(settings.edgeWidth) as EnergyWaveShieldUniforms['uEdgeWidth'],
    uEffectFadeHeight: uniform(
      ENERGY_WAVE_FADE_HEIGHT_METERS,
    ) as EnergyWaveShieldUniforms['uEffectFadeHeight'],
    uEffectFullHeight: uniform(
      ENERGY_WAVE_FULL_EFFECT_HEIGHT_METERS,
    ) as EnergyWaveShieldUniforms['uEffectFullHeight'],
    uEmissionStrength: uniform(
      settings.emissionStrength,
    ) as EnergyWaveShieldUniforms['uEmissionStrength'],
    uFadeSoftness: uniform(settings.fadeSoftness) as EnergyWaveShieldUniforms['uFadeSoftness'],
    uInvertTopFade: uniform(
      settings.invertTopFade ? 1 : 0,
    ) as EnergyWaveShieldUniforms['uInvertTopFade'],
    uNoiseScale: uniform(settings.noiseScale) as EnergyWaveShieldUniforms['uNoiseScale'],
    uNoiseStrength: uniform(settings.noiseStrength) as EnergyWaveShieldUniforms['uNoiseStrength'],
    uNoiseTexture: { value: noiseTexture },
    uOpacity: uniform(settings.opacity) as EnergyWaveShieldUniforms['uOpacity'],
    uRiseProgress: uniform(settings.riseProgress) as EnergyWaveShieldUniforms['uRiseProgress'],
    uTime: uniform(0) as EnergyWaveShieldUniforms['uTime'],
    uTimeSpeed: uniform(settings.timeSpeed) as EnergyWaveShieldUniforms['uTimeSpeed'],
    uTopFadePower: uniform(settings.topFadePower) as EnergyWaveShieldUniforms['uTopFadePower'],
    uTopFadeStart: uniform(settings.topFadeStart) as EnergyWaveShieldUniforms['uTopFadeStart'],
    uTopY: uniform(1) as EnergyWaveShieldUniforms['uTopY'],
    uWaveFrequency: uniform(settings.waveFrequency) as EnergyWaveShieldUniforms['uWaveFrequency'],
    uWaveSpeed: uniform(settings.waveSpeed) as EnergyWaveShieldUniforms['uWaveSpeed'],
    uWaveTransparency: uniform(
      settings.waveTransparency,
    ) as EnergyWaveShieldUniforms['uWaveTransparency'],
  }
}

export function applyEnergyWaveShieldUniforms(
  uniforms: EnergyWaveShieldUniforms,
  settings: EnergyWaveShieldSettings,
) {
  uniforms.uColor.value.set(settings.color)
  uniforms.uColorEdge.value.set(settings.colorEdge)
  uniforms.uEdgeWidth.value = settings.edgeWidth
  uniforms.uEmissionStrength.value = settings.emissionStrength
  uniforms.uFadeSoftness.value = settings.fadeSoftness
  uniforms.uInvertTopFade.value = settings.invertTopFade ? 1 : 0
  uniforms.uNoiseScale.value = settings.noiseScale
  uniforms.uNoiseStrength.value = settings.noiseStrength
  uniforms.uOpacity.value = settings.opacity
  uniforms.uRiseProgress.value = settings.riseProgress
  uniforms.uTimeSpeed.value = settings.timeSpeed
  uniforms.uTopFadePower.value = settings.topFadePower
  uniforms.uTopFadeStart.value = settings.topFadeStart
  uniforms.uWaveFrequency.value = settings.waveFrequency
  uniforms.uWaveSpeed.value = settings.waveSpeed
  uniforms.uWaveTransparency.value = settings.waveTransparency
}

export function createEnergyWaveShieldMaterial(
  noiseTexture: Texture,
  settings: EnergyWaveShieldSettings = DEFAULT_ENERGY_WAVE_SHIELD_SETTINGS,
): EnergyWaveShieldMaterial {
  const material = new MeshBasicNodeMaterial({
    color: '#ffffff',
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    transparent: true,
  }) as EnergyWaveShieldMaterial
  const uniforms = createEnergyWaveShieldUniforms(noiseTexture, settings)
  const noiseTextureNode: any = textureNode(noiseTexture)
  const animatedTime: any = uniforms.uTime.mul(uniforms.uTimeSpeed)
  const localNormal: any = normalLocal.normalize()
  const worldViewDirection: any = cameraPosition.sub(positionWorld).normalize()
  const uvNode: any = uv()

  const primaryFlowPosition: any = positionLocal.add(
    vec3(
      sin(positionLocal.y.mul(3.1).add(animatedTime.mul(1.45))).mul(0.12),
      animatedTime.mul(-0.58),
      cos(positionLocal.x.mul(2.8).sub(animatedTime.mul(1.1))).mul(0.14),
    ),
  )
  const secondaryFlowPosition: any = positionLocal.add(
    vec3(
      cos(positionLocal.z.mul(2.5).add(animatedTime.mul(0.95))).mul(0.16),
      animatedTime.mul(-0.41),
      sin(positionLocal.x.mul(2.2).sub(animatedTime.mul(1.38))).mul(0.12),
    ),
  )

  const noiseValue: any = triplanarTexture(
    noiseTextureNode,
    null,
    null,
    uniforms.uNoiseScale.mul(0.85),
    primaryFlowPosition,
    localNormal,
  ).r
  const noiseValue2: any = triplanarTexture(
    noiseTextureNode,
    null,
    null,
    uniforms.uNoiseScale.mul(1.35),
    secondaryFlowPosition.add(vec3(0.73, -0.41, 0.58)),
    localNormal,
  ).r
  const noiseValue3: any = triplanarTexture(
    noiseTextureNode,
    null,
    null,
    uniforms.uNoiseScale.mul(1.08),
    primaryFlowPosition.add(vec3(0.04, -0.03, 0.02)),
    localNormal,
  ).r
  const noiseValue4: any = triplanarTexture(
    noiseTextureNode,
    null,
    null,
    uniforms.uNoiseScale.mul(1.08),
    secondaryFlowPosition.add(vec3(-0.03, 0.05, -0.02)),
    localNormal,
  ).r
  const combinedNoise: any = mix(noiseValue, noiseValue2, 0.5)
  const heightRange: any = uniforms.uTopY.sub(uniforms.uBottomY).max(float(0.0001))
  const normalizedHeight: any = positionWorld.y.sub(uniforms.uBottomY).div(heightRange).clamp(0, 1)
  const bottomDistance: any = positionWorld.y.sub(uniforms.uBottomY).max(0)
  const heightMask: any = smoothstep(
    uniforms.uEffectFullHeight,
    uniforms.uEffectFullHeight.add(uniforms.uEffectFadeHeight),
    normalizedHeight,
  )
    .oneMinus()
    .mul(smoothstep(float(0), float(0.03), uniforms.uRiseProgress))
    .clamp(0, 1)
  const wavePattern: any = sin(
    normalizedHeight
      .mul(uniforms.uWaveFrequency)
      .mul(6.28318530718)
      .add(uniforms.uTime.mul(uniforms.uWaveSpeed))
      .add(combinedNoise.mul(3)),
  )
    .mul(0.5)
    .add(0.5)
  const waveAlpha: any = mix(float(1), wavePattern, uniforms.uWaveTransparency.mul(0.7))
  const sideFade: any = smoothstep(float(0.02), float(0.18), uvNode.x).mul(
    smoothstep(float(0.82), float(0.98), uvNode.x).oneMinus(),
  )
  const bodyMask: any = heightMask.mul(waveAlpha).mul(sideFade)
  const edgeFactor: any = smoothstep(
    float(0),
    uniforms.uEdgeWidth.max(float(0.0001)).mul(2),
    bottomDistance.sub(uniforms.uEffectFullHeight.mul(heightRange)).abs(),
  )
    .oneMinus()
    .mul(heightMask)
  const contourFieldA: any = combinedNoise
    .mul(2.8)
    .add(noiseValue2.mul(0.9))
    .add(normalizedHeight.mul(0.45))
    .sub(animatedTime.mul(0.22))
  const contourFieldB: any = noiseValue
    .mul(2.25)
    .sub(combinedNoise.mul(0.75))
    .add(normalizedHeight.mul(0.78))
    .add(uvNode.x.mul(0.16))
    .add(animatedTime.mul(0.18))
  const contourA: any = smoothstep(
    float(0.11),
    float(0.24),
    contourFieldA.fract().sub(0.5).abs(),
  ).oneMinus()
  const contourB: any = smoothstep(float(0.1), float(0.22), contourFieldB.fract().sub(0.5).abs())
    .oneMinus()
    .mul(0.84)
  const traceField: any = smoothstep(float(0.018), float(0.075), noiseValue3.sub(noiseValue4).abs())
    .oneMinus()
    .mul(0.88)
  const flowField: any = smoothstep(
    float(0.08),
    float(0.24),
    combinedNoise
      .mul(1.55)
      .add(noiseValue2.mul(0.4))
      .add(normalizedHeight.mul(0.95))
      .sub(animatedTime.mul(0.44))
      .add(uvNode.x.mul(0.12))
      .fract()
      .sub(0.5)
      .abs(),
  )
    .oneMinus()
    .mul(0.7)
  const filaments: any = contourA
    .max(contourB)
    .max(traceField)
    .max(flowField)
    .pow(1.15)
    .mul(bodyMask)
  const fresnel: any = float(1)
    .sub(dot(normalWorld.normalize(), worldViewDirection).abs().clamp(0, 1))
    .pow(2.3)
    .mul(heightMask)
  const pulse: any = sin(uniforms.uTime.mul(3)).mul(0.1).add(0.9)
  const bodyGlow: any = bodyMask
    .mul(combinedNoise.mul(0.11).add(0.09))
    .mul(wavePattern.mul(0.28).add(0.48))
  const cloudBody: any = combinedNoise.mul(1.14).sub(0.18).max(0).pow(1.35).mul(bodyMask)
  const sparkMask: any = smoothstep(float(0.78), float(0.96), combinedNoise).mul(bodyMask)
  const finalColor: any = uniforms.uColor
    .mul(
      bodyGlow
        .mul(2.2)
        .add(cloudBody.mul(0.72))
        .add(filaments.mul(0.24))
        .add(flowField.mul(0.18))
        .add(fresnel.mul(0.12)),
    )
    .add(
      uniforms.uColorEdge.mul(
        filaments
          .mul(0.72)
          .add(flowField.mul(0.26))
          .add(edgeFactor.mul(0.48))
          .add(fresnel.mul(0.18))
          .add(sparkMask.mul(0.1)),
      ),
    )
    .mul(uniforms.uEmissionStrength)
    .mul(pulse)
    .mul(combinedNoise.mul(0.18).add(0.85))
  const finalAlpha: any = bodyGlow
    .mul(0.52)
    .add(cloudBody.mul(0.18))
    .add(filaments.mul(0.72))
    .add(edgeFactor.mul(0.32))
    .add(fresnel.mul(0.14))
    .mul(uniforms.uOpacity)
    .clamp(0, 1)

  material.blending = AdditiveBlending
  material.toneMapped = false
  material.colorNode = finalColor
  material.maskNode = finalAlpha.greaterThan(float(0.001))
  material.opacityNode = finalAlpha
  material.uniforms = uniforms
  material.userData.pascalEnergyWaveShieldUniforms = uniforms

  return material
}
