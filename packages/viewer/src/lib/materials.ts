import {
  getMaterialPresetByRef,
  type MaterialMapProperties,
  type MaterialPresetPayload,
  type MaterialProperties,
  type MaterialSchema,
  resolveMaterial,
} from '@pascal-app/core'
import * as THREE from 'three'

const sideMap: Record<MaterialProperties['side'], THREE.Side> = {
  front: THREE.FrontSide,
  back: THREE.BackSide,
  double: THREE.DoubleSide,
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()
const textureCache = new Map<string, THREE.Texture>()
const textureLoadPromises = new Map<string, Promise<THREE.Texture | null>>()
const textureLoader = new THREE.TextureLoader()
const wrapMap = {
  Repeat: THREE.RepeatWrapping,
  ClampToEdge: THREE.ClampToEdgeWrapping,
  MirroredRepeat: THREE.MirroredRepeatWrapping,
} as const

type StandardMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial
type TextureSlot =
  | 'map'
  | 'normalMap'
  | 'roughnessMap'
  | 'metalnessMap'
  | 'displacementMap'
  | 'aoMap'
  | 'bumpMap'
  | 'alphaMap'
  | 'lightMap'
  | 'emissiveMap'

const SRGB_TEXTURE_SLOTS: TextureSlot[] = ['map', 'emissiveMap']

function getCacheKey(props: MaterialProperties): string {
  return `${props.color}-${props.roughness}-${props.metalness}-${props.opacity}-${props.transparent}-${props.side}`
}

function getTextureKey(material?: MaterialSchema): string {
  const texture = material?.texture
  if (!texture) return 'none'
  const repeat = texture.repeat?.join('x') ?? 'default'
  const scale = texture.scale ?? 'default'
  return `${texture.url}-${repeat}-${scale}`
}

function getTexture(material?: MaterialSchema): THREE.Texture | undefined {
  const textureConfig = material?.texture
  if (!textureConfig?.url) return undefined

  const cacheKey = getTextureKey(material)
  const cached = textureCache.get(cacheKey)
  if (cached) return cached

  const texture = textureLoader.load(textureConfig.url)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping

  const repeatX = textureConfig.repeat?.[0] ?? textureConfig.scale ?? 1
  const repeatY = textureConfig.repeat?.[1] ?? textureConfig.scale ?? 1
  texture.repeat.set(repeatX, repeatY)
  texture.colorSpace = THREE.SRGBColorSpace

  textureCache.set(cacheKey, texture)
  return texture
}

function isStandardMaterial(material: THREE.Material): material is StandardMaterial {
  return (
    material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
  )
}

function applyTextureProperties(
  texture: THREE.Texture,
  props: MaterialMapProperties,
  slot?: TextureSlot,
): THREE.Texture {
  texture.wrapS = wrapMap[props.wrapS]
  texture.wrapT = wrapMap[props.wrapT]
  texture.repeat.set(props.repeatX, props.repeatY)
  texture.rotation = props.rotation
  texture.flipY = props.flipY
  texture.colorSpace = SRGB_TEXTURE_SLOTS.includes(slot ?? 'map')
    ? THREE.SRGBColorSpace
    : THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function getPresetTextureCacheKey(
  path: string,
  props: MaterialMapProperties,
  slot?: TextureSlot,
): string {
  return `${path}-${props.repeatX}-${props.repeatY}-${props.rotation}-${props.wrapS}-${props.wrapT}-${props.flipY}-${slot ?? 'map'}`
}

function getPresetTexture(
  path: string,
  props: MaterialMapProperties,
  slot?: TextureSlot,
): THREE.Texture {
  const cacheKey = getPresetTextureCacheKey(path, props, slot)
  const cached = textureCache.get(cacheKey)
  if (cached) return cached

  const texture = textureLoader.load(path)
  applyTextureProperties(texture, props, slot)
  textureCache.set(cacheKey, texture)
  return texture
}

async function loadPresetTexture(
  path: string,
  props: MaterialMapProperties,
  slot?: TextureSlot,
): Promise<THREE.Texture | null> {
  const cacheKey = getPresetTextureCacheKey(path, props, slot)
  const cached = textureCache.get(cacheKey)
  if (cached) return cached

  const existingPromise = textureLoadPromises.get(cacheKey)
  if (existingPromise) return existingPromise

  const promise = textureLoader
    .loadAsync(path)
    .then((texture) => {
      applyTextureProperties(texture, props, slot)
      textureCache.set(cacheKey, texture)
      textureLoadPromises.delete(cacheKey)
      return texture
    })
    .catch((error) => {
      console.warn('[viewer] Failed to load material texture', path, error)
      textureLoadPromises.delete(cacheKey)
      return null
    })

  textureLoadPromises.set(cacheKey, promise)
  return promise
}

function queueTextureAssignment(
  material: StandardMaterial,
  slot: TextureSlot,
  path: string | undefined,
  props: MaterialMapProperties,
) {
  if (!path) {
    material[slot] = null
    return
  }

  const cacheKey = getPresetTextureCacheKey(path, props, slot)
  const cached = textureCache.get(cacheKey)
  if (cached) {
    material[slot] = cached
    return
  }

  material[slot] = null

  void loadPresetTexture(path, props, slot).then((texture) => {
    if (!texture) return
    material[slot] = texture
    material.needsUpdate = true
  })
}

function applyMaterialMapProperties(
  material: StandardMaterial,
  mapProperties: MaterialMapProperties,
) {
  material.color.set(mapProperties.color)
  material.roughness = mapProperties.roughness
  material.metalness = mapProperties.metalness
  material.emissiveIntensity = mapProperties.emissiveIntensity
  material.emissive.set(mapProperties.emissiveColor)
  material.displacementScale = mapProperties.displacementScale
  material.bumpScale = mapProperties.bumpScale
  material.aoMapIntensity = mapProperties.aoMapIntensity
  material.lightMapIntensity = mapProperties.lightMapIntensity
  material.transparent = mapProperties.transparent
  material.opacity = mapProperties.opacity
  material.side =
    mapProperties.side === 0
      ? THREE.FrontSide
      : mapProperties.side === 1
        ? THREE.BackSide
        : THREE.DoubleSide
  material.normalScale.set(mapProperties.normalScaleX, mapProperties.normalScaleY)
  material.needsUpdate = true
}

function applyMaterialPresetTextures(material: StandardMaterial, preset: MaterialPresetPayload) {
  const { maps, mapProperties } = preset

  queueTextureAssignment(material, 'map', maps.albedoMap, mapProperties)
  queueTextureAssignment(material, 'normalMap', maps.normalMap, mapProperties)
  queueTextureAssignment(material, 'roughnessMap', maps.roughnessMap, mapProperties)
  queueTextureAssignment(material, 'metalnessMap', maps.metalnessMap, mapProperties)
  queueTextureAssignment(material, 'displacementMap', maps.displacementMap, mapProperties)
  queueTextureAssignment(material, 'aoMap', maps.aoMap, mapProperties)
  queueTextureAssignment(material, 'bumpMap', maps.bumpMap, mapProperties)
  queueTextureAssignment(material, 'alphaMap', maps.alphaMap, mapProperties)
  queueTextureAssignment(material, 'lightMap', maps.lightMap, mapProperties)
  queueTextureAssignment(material, 'emissiveMap', maps.emissiveMap, mapProperties)
  material.needsUpdate = true
}

export function applyMaterialPresetToMaterials(
  materialInput: THREE.Material | THREE.Material[],
  preset: MaterialPresetPayload | null | undefined,
) {
  if (!preset) return

  const materials = (Array.isArray(materialInput) ? materialInput : [materialInput]).filter(
    isStandardMaterial,
  )

  if (materials.length === 0) return

  for (const material of materials) {
    applyMaterialMapProperties(material, preset.mapProperties)
    applyMaterialPresetTextures(material, preset)
  }
}

export function createMaterialFromPreset(
  preset: MaterialPresetPayload,
): THREE.MeshStandardMaterial {
  const cacheKey = JSON.stringify(preset)

  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey)!
  }

  const material = new THREE.MeshStandardMaterial()
  applyMaterialPresetToMaterials(material, preset)
  materialCache.set(cacheKey, material)
  return material
}

export function createMaterialFromPresetRef(
  materialPreset?: string,
): THREE.MeshStandardMaterial | null {
  const preset = getMaterialPresetByRef(materialPreset)
  if (!preset) return null
  return createMaterialFromPreset(preset)
}

export function createMaterial(material?: MaterialSchema): THREE.MeshStandardMaterial {
  const props = resolveMaterial(material)
  const cacheKey = `${getCacheKey(props)}-${getTextureKey(material)}`

  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey)!
  }

  const map = getTexture(material)

  const threeMaterial = new THREE.MeshStandardMaterial({
    color: props.color,
    roughness: props.roughness,
    metalness: props.metalness,
    opacity: props.opacity,
    transparent: props.transparent,
    side: sideMap[props.side],
    map,
  })

  materialCache.set(cacheKey, threeMaterial)
  return threeMaterial
}

export function createDefaultMaterial(
  color = '#ffffff',
  roughness = 0.9,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    side: THREE.FrontSide,
  })
}

export const DEFAULT_WALL_MATERIAL = createDefaultMaterial('#ffffff', 0.9)
export const DEFAULT_SLAB_MATERIAL = createDefaultMaterial('#e5e5e5', 0.8)
export const DEFAULT_DOOR_MATERIAL = createDefaultMaterial('#8b4513', 0.7)
export const DEFAULT_WINDOW_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#87ceeb',
  roughness: 0.1,
  metalness: 0.1,
  opacity: 0.3,
  transparent: true,
  side: THREE.DoubleSide,
})
export const DEFAULT_CEILING_MATERIAL = createDefaultMaterial('#f5f5dc', 0.95)
export const DEFAULT_ROOF_MATERIAL = createDefaultMaterial('#808080', 0.85)
export const DEFAULT_STAIR_MATERIAL = createDefaultMaterial('#ffffff', 0.9)

export function disposeMaterial(material: THREE.Material): void {
  material.dispose()
}

export function clearMaterialCache(): void {
  for (const material of materialCache.values()) {
    material.dispose()
  }
  materialCache.clear()

  for (const texture of textureCache.values()) {
    texture.dispose()
  }
  textureCache.clear()
  textureLoadPromises.clear()
}
