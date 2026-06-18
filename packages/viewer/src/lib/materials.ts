import {
  getMaterialPresetByRef,
  type MaterialMapProperties,
  type MaterialPresetPayload,
  type MaterialProperties,
  type MaterialSchema,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterial,
  type SceneMaterialId,
  type SurfaceRole,
} from '@pascal-app/core'
import * as THREE from 'three'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'

import { resolveCdnUrl } from './asset-url'
import { isKtx2Url, ktx2Loader } from './ktx2-loader'
import { getSceneTheme } from './scene-themes'

export type RenderShading = 'solid' | 'rendered'
export type ColorPreset = 'clay' | 'white' | 'mono' | 'blueprint'

export const CLAY_PALETTE: Record<SurfaceRole, string> = {
  wall: '#dcd6c7',
  floor: '#cfc8b6',
  ceiling: '#e4ded0',
  roof: '#b8ad96',
  joinery: '#c4bba6',
  glazing: '#c8d4dc',
  furnishing: '#d2ccbe',
}

export const WHITE_PALETTE: Record<SurfaceRole, string> = {
  wall: '#f4f3ef',
  floor: '#ece9e2',
  ceiling: '#fbfaf6',
  roof: '#dedbd2',
  joinery: '#e8e5dc',
  glazing: '#dbe8ee',
  furnishing: '#efede7',
}

export const MONO_PALETTE: Record<SurfaceRole, string> = {
  wall: '#c8c8c8',
  floor: '#b8b8b8',
  ceiling: '#d8d8d8',
  roof: '#9a9a9a',
  joinery: '#adadad',
  glazing: '#c2cbd0',
  furnishing: '#c0c0c0',
}

export const BLUEPRINT_PALETTE: Record<SurfaceRole, string> = {
  wall: '#90a9c7',
  floor: '#7f98ba',
  ceiling: '#aec0d8',
  roof: '#5f789b',
  joinery: '#6f86a8',
  glazing: '#b6d7ea',
  furnishing: '#8ba2bf',
}

export const PRESET_PALETTES: Record<ColorPreset, Record<SurfaceRole, string>> = {
  clay: CLAY_PALETTE,
  white: WHITE_PALETTE,
  mono: MONO_PALETTE,
  blueprint: BLUEPRINT_PALETTE,
}

export function resolveSurfaceColor(
  role: SurfaceRole,
  preset: ColorPreset,
  sceneThemeId?: string,
): string {
  // The active scene theme may tint individual roles (e.g. Mediterranean's blue
  // roof); fall back to the chosen colour preset's palette when it doesn't.
  const tints = sceneThemeId ? getSceneTheme(sceneThemeId).clayTints : undefined
  return tints?.[role] ?? (PRESET_PALETTES[preset] ?? CLAY_PALETTE)[role]
}

// DoubleSide on any NodeMaterial inside the MRT scenePass (SSGI's output /
// diffuseColor / normal targets) causes WebGPU to create a render pipeline
// whose back-face shader variant doesn't declare outputs for every MRT target
// — the validator rejects it and poisons the entire render context. FrontSide
// avoids that code path. Same pattern as MeshStandardMaterial in renderer.tsx.
export const glassMaterial = new MeshLambertNodeMaterial({
  color: '#e0f2fe',
  transparent: true,
  opacity: 0.35,
  side: THREE.FrontSide,
})

function resolveNodeMaterialSide(side: THREE.Side): THREE.Side {
  return side === THREE.DoubleSide ? THREE.FrontSide : side
}

const sideMap: Record<MaterialProperties['side'], THREE.Side> = {
  front: THREE.FrontSide,
  back: THREE.BackSide,
  double: THREE.FrontSide,
}

const materialCache = new Map<string, THREE.Material>()
const defaultMaterialCache = new Map<string, THREE.Material>()
const surfaceRoleMaterialCache = new Map<string, THREE.Material>()
const textureCache = new Map<string, THREE.Texture>()
const textureLoadPromises = new Map<string, Promise<THREE.Texture | null>>()
const textureLoader = new THREE.TextureLoader()

// `.ktx2` finish maps transcode through the shared KTX2 loader (support is
// detected once at viewer init); everything else loads as a normal image.
function pickTextureLoader(url: string): THREE.TextureLoader {
  // KTX2Loader's load/loadAsync are call-compatible with TextureLoader (url →
  // Texture / Promise<Texture>); cast for typing.
  return isKtx2Url(url) ? (ktx2Loader as unknown as THREE.TextureLoader) : textureLoader
}
const wrapMap = {
  Repeat: THREE.RepeatWrapping,
  ClampToEdge: THREE.ClampToEdgeWrapping,
  MirroredRepeat: THREE.MirroredRepeatWrapping,
} as const

type CommonMaterial = THREE.Material & {
  color: THREE.Color
  map?: THREE.Texture | null
  emissive?: THREE.Color
  emissiveIntensity?: number
  opacity: number
  transparent: boolean
  side: THREE.Side
  needsUpdate: boolean
}

type StandardMaterial =
  | THREE.MeshStandardMaterial
  | THREE.MeshPhysicalMaterial
  | MeshStandardNodeMaterial

type TextureMaterial = CommonMaterial & Partial<Record<TextureSlot, THREE.Texture | null>>

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
const TEXTURE_SLOTS: TextureSlot[] = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'displacementMap',
  'aoMap',
  'bumpMap',
  'alphaMap',
  'lightMap',
  'emissiveMap',
]

function getTextureChannel(slot?: TextureSlot): number {
  if (slot === 'aoMap' || slot === 'lightMap') {
    return 2
  }

  return 0
}

function getCacheKey(props: MaterialProperties, shading: RenderShading): string {
  return `${shading}-${props.color}-${props.roughness}-${props.metalness}-${props.opacity}-${props.transparent}-${props.side}`
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

  const texture = pickTextureLoader(textureConfig.url).load(textureConfig.url)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping

  const repeatX = textureConfig.repeat?.[0] ?? textureConfig.scale ?? 1
  const repeatY = textureConfig.repeat?.[1] ?? textureConfig.scale ?? 1
  texture.repeat.set(repeatX, repeatY)
  texture.updateMatrix()
  texture.colorSpace = THREE.SRGBColorSpace

  textureCache.set(cacheKey, texture)
  return texture
}

function isStandardMaterial(material: THREE.Material): material is StandardMaterial {
  return (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial ||
    material instanceof MeshStandardNodeMaterial
  )
}

function isCommonMaterial(material: THREE.Material): material is CommonMaterial {
  return 'color' in material && material.color instanceof THREE.Color
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
  texture.updateMatrix()
  texture.channel = getTextureChannel(slot)
  texture.colorSpace = SRGB_TEXTURE_SLOTS.includes(slot ?? 'map')
    ? THREE.SRGBColorSpace
    : THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function setTextureCacheKey(texture: THREE.Texture, cacheKey: string): THREE.Texture {
  texture.userData.pascalTextureCacheKey = cacheKey
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
  const resolvedPath = resolveCdnUrl(path) ?? path
  const cacheKey = getPresetTextureCacheKey(resolvedPath, props, slot)
  const cached = textureCache.get(cacheKey)
  if (cached) return cached

  const texture = pickTextureLoader(resolvedPath).load(resolvedPath)
  applyTextureProperties(texture, props, slot)
  setTextureCacheKey(texture, cacheKey)
  textureCache.set(cacheKey, texture)
  return texture
}

function createAssignedTexture(
  source: THREE.Texture,
  props: MaterialMapProperties,
  slot?: TextureSlot,
): THREE.Texture {
  const texture = source.clone()
  const cacheKey = source.userData.pascalTextureCacheKey
  if (typeof cacheKey === 'string') {
    setTextureCacheKey(texture, cacheKey)
  }
  return applyTextureProperties(texture, props, slot)
}

function applyTexturePropertiesToMaterial(material: CommonMaterial, props: MaterialMapProperties) {
  const slots = isStandardMaterial(material) ? TEXTURE_SLOTS : (['map'] as const)
  const textureMaterial = material as TextureMaterial

  for (const slot of slots) {
    const texture = textureMaterial[slot as TextureSlot]
    if (!texture) continue
    applyTextureProperties(texture, props, slot as TextureSlot)
  }
}

async function loadPresetTexture(
  path: string,
  props: MaterialMapProperties,
  slot?: TextureSlot,
): Promise<THREE.Texture | null> {
  const resolvedPath = resolveCdnUrl(path) ?? path
  const cacheKey = getPresetTextureCacheKey(resolvedPath, props, slot)
  const cached = textureCache.get(cacheKey)
  if (cached) return cached

  const existingPromise = textureLoadPromises.get(cacheKey)
  if (existingPromise) return existingPromise

  const promise = pickTextureLoader(resolvedPath)
    .loadAsync(resolvedPath)
    .then((texture) => {
      applyTextureProperties(texture, props, slot)
      setTextureCacheKey(texture, cacheKey)
      textureCache.set(cacheKey, texture)
      textureLoadPromises.delete(cacheKey)
      return texture
    })
    .catch((error) => {
      console.warn('[viewer] Failed to load material texture', resolvedPath, error)
      textureLoadPromises.delete(cacheKey)
      return null
    })

  textureLoadPromises.set(cacheKey, promise)
  return promise
}

function queueTextureAssignment(
  material: CommonMaterial,
  slot: TextureSlot,
  path: string | undefined,
  props: MaterialMapProperties,
) {
  const textureMaterial = material as TextureMaterial

  if (!path) {
    textureMaterial[slot] = null
    return
  }

  const resolvedPath = resolveCdnUrl(path) ?? path
  const cacheKey = getPresetTextureCacheKey(resolvedPath, props, slot)

  if (textureMaterial[slot]?.userData.pascalTextureCacheKey === cacheKey) {
    applyTextureProperties(textureMaterial[slot], props, slot)
    return
  }

  const cached = textureCache.get(cacheKey)
  if (cached) {
    textureMaterial[slot] = createAssignedTexture(cached, props, slot)
    material.needsUpdate = true
    return
  }

  textureMaterial[slot] = null

  loadPresetTexture(path, props, slot).then((texture) => {
    if (!texture) return
    textureMaterial[slot] = createAssignedTexture(texture, props, slot)
    material.needsUpdate = true
  })
}

function applyMaterialMapProperties(
  material: CommonMaterial,
  mapProperties: MaterialMapProperties,
) {
  material.color.set(mapProperties.color)
  if (isStandardMaterial(material)) {
    material.roughness = mapProperties.roughness
    material.metalness = mapProperties.metalness
    material.displacementScale = mapProperties.displacementScale
    material.bumpScale = mapProperties.bumpScale
    material.aoMapIntensity = mapProperties.aoMapIntensity
    material.lightMapIntensity = mapProperties.lightMapIntensity
    material.normalScale.set(mapProperties.normalScaleX, mapProperties.normalScaleY)
  }
  if (material.emissive) {
    material.emissive.set(mapProperties.emissiveColor)
  }
  if ('emissiveIntensity' in material) {
    material.emissiveIntensity = mapProperties.emissiveIntensity
  }
  material.transparent = mapProperties.transparent
  material.opacity = mapProperties.opacity
  material.side = resolveNodeMaterialSide(
    mapProperties.side === 0
      ? THREE.FrontSide
      : mapProperties.side === 1
        ? THREE.BackSide
        : THREE.DoubleSide,
  )
  applyTexturePropertiesToMaterial(material, mapProperties)
  material.needsUpdate = true
}

function applyMaterialPresetTextures(material: CommonMaterial, preset: MaterialPresetPayload) {
  const { maps, mapProperties } = preset

  queueTextureAssignment(material, 'map', maps.albedoMap, mapProperties)
  if (!isStandardMaterial(material)) {
    material.needsUpdate = true
    return
  }

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
    isCommonMaterial,
  )

  if (materials.length === 0) return

  for (const material of materials) {
    applyMaterialMapProperties(material, preset.mapProperties)
    applyMaterialPresetTextures(material, preset)
  }
}

export function createMaterialFromPreset(
  preset: MaterialPresetPayload,
  shading: RenderShading = 'rendered',
): THREE.Material {
  const cacheKey = `${shading}-${JSON.stringify(preset)}`

  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey)!
  }

  const material =
    shading === 'solid' ? new MeshLambertNodeMaterial() : new MeshStandardNodeMaterial()
  applyMaterialPresetToMaterials(material, preset)
  materialCache.set(cacheKey, material)
  return material
}

export function createMaterialFromPresetRef(
  materialPreset?: string,
  shading: RenderShading = 'rendered',
): THREE.Material | null {
  const preset = getMaterialPresetByRef(materialPreset)
  if (!preset) return null
  return createMaterialFromPreset(preset, shading)
}

export function createMaterial(
  material?: MaterialSchema,
  shading: RenderShading = 'rendered',
): THREE.Material {
  const props = resolveMaterial(material)
  const cacheKey = `${getCacheKey(props, shading)}-${getTextureKey(material)}`

  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey)!
  }

  const map = getTexture(material)
  const materialParams: {
    color: string
    map?: THREE.Texture
    opacity: number
    side: THREE.Side
    transparent: boolean
  } = {
    color: props.color,
    opacity: props.opacity,
    transparent: props.transparent,
    side: sideMap[props.side],
  }

  if (map) materialParams.map = map

  const threeMaterial =
    shading === 'solid'
      ? new MeshLambertNodeMaterial(materialParams)
      : new MeshStandardNodeMaterial({
          ...materialParams,
          roughness: props.roughness,
          metalness: props.metalness,
        })

  materialCache.set(cacheKey, threeMaterial)
  return threeMaterial
}

/**
 * Resolve a MaterialRef ('library:<id>' | 'scene:<id>') to a three.js material.
 * Returns null for an unknown / dangling ref so callers fall back to the
 * slot's default (authored material, then themed default). Never throws.
 */
export function resolveMaterialRef(
  ref: string | undefined,
  sceneMaterials: Record<SceneMaterialId, SceneMaterial> | undefined,
  shading: RenderShading = 'rendered',
): THREE.Material | null {
  const parsed = parseMaterialRef(ref)
  if (!parsed) return null
  if (parsed.kind === 'library') return createMaterialFromPresetRef(ref, shading)
  const sceneMaterial = sceneMaterials?.[parsed.id as SceneMaterialId]
  if (!sceneMaterial) return null
  return createMaterial(sceneMaterial.material, shading)
}

/**
 * Resolve a node kind's declared slot default — either a catalog `library:<id>`
 * finish or a flat `#rrggbb` colour — to a renderable material. Shared by the
 * procedural kinds whose colored-mode unpainted appearance comes from a
 * declarative default (slab, wall).
 */
export function resolveSlotDefaultMaterial(
  slotDefault: string,
  shading: RenderShading = 'rendered',
  roughness = 0.9,
): THREE.Material {
  if (parseMaterialRef(slotDefault)?.kind === 'library') {
    return (
      createMaterialFromPresetRef(slotDefault, shading) ??
      createDefaultMaterial('#ffffff', roughness, shading)
    )
  }
  return createDefaultMaterial(slotDefault, roughness, shading)
}

export function createDefaultMaterial(
  color = '#ffffff',
  roughness = 0.9,
  shading: RenderShading = 'rendered',
  side: THREE.Side = THREE.FrontSide,
): THREE.Material {
  const resolvedSide = resolveNodeMaterialSide(side)
  if (shading === 'solid') {
    return new MeshLambertNodeMaterial({
      color,
      side: resolvedSide,
    })
  }

  return new MeshStandardNodeMaterial({
    color,
    roughness,
    metalness: 0,
    side: resolvedSide,
  })
}

function cachedDefaultMaterial(
  key: string,
  color: string,
  roughness: number,
  shading: RenderShading,
  side: THREE.Side = THREE.FrontSide,
): THREE.Material {
  const cacheKey = `${key}-${shading}`
  const cached = defaultMaterialCache.get(cacheKey)
  if (cached) return cached

  const material = createDefaultMaterial(color, roughness, shading, side)
  defaultMaterialCache.set(cacheKey, material)
  return material
}

export function createSurfaceRoleMaterial(
  role: SurfaceRole,
  preset: ColorPreset,
  side: THREE.Side = THREE.FrontSide,
  sceneThemeId?: string,
): THREE.Material {
  // DoubleSide on glazing trips the MRT back-face pipeline issue documented
  // on `glassMaterial` above — the validator rejects the back-face variant
  // for missing MRT outputs and poisons the render context (manifests as
  // "Color target has no corresponding fragment stage output" on scene
  // open, since the dormer's window-assembly mounts the glazing material
  // on both gable faces on the first frame). Callers that need both sides
  // visible (e.g. dormer back gable) must rotate the host mesh 180° so the
  // FrontSide faces the viewer.
  const resolvedSide =
    role === 'glazing' ? THREE.FrontSide : resolveNodeMaterialSide(side ?? THREE.FrontSide)
  const cacheKey = `${role}-${preset}-${resolvedSide}-${sceneThemeId ?? 'base'}`
  const cached = surfaceRoleMaterialCache.get(cacheKey)
  if (cached) return cached

  const material =
    role === 'glazing'
      ? new MeshLambertNodeMaterial({
          color: resolveSurfaceColor(role, preset, sceneThemeId),
          depthWrite: false,
          opacity: 0.25,
          side: resolvedSide,
          transparent: true,
        })
      : new MeshLambertNodeMaterial({
          color: resolveSurfaceColor(role, preset, sceneThemeId),
          side: resolvedSide,
        })

  material.userData.__pascalCachedMaterial = true
  surfaceRoleMaterialCache.set(cacheKey, material)
  return material
}

export function baseMaterial(shading: RenderShading = 'rendered'): THREE.Material {
  return cachedDefaultMaterial('base', '#f2f0ed', 0.5, shading)
}

export function DEFAULT_WALL_MATERIAL(shading: RenderShading = 'rendered'): THREE.Material {
  return cachedDefaultMaterial('wall', '#ffffff', 0.9, shading)
}

export function DEFAULT_SLAB_MATERIAL(shading: RenderShading = 'rendered'): THREE.Material {
  return cachedDefaultMaterial('slab', '#e5e5e5', 0.8, shading)
}

export function DEFAULT_DOOR_MATERIAL(shading: RenderShading = 'rendered'): THREE.Material {
  return cachedDefaultMaterial('door', '#8b4513', 0.7, shading)
}

export function DEFAULT_WINDOW_MATERIAL(shading: RenderShading = 'rendered'): THREE.Material {
  const cacheKey = `window-${shading}`
  const cached = defaultMaterialCache.get(cacheKey)
  if (cached) return cached

  // DoubleSide on a NodeMaterial inside the MRT scene pass compiles a back-face
  // pipeline variant whose fragment outputs don't cover every MRT target — the
  // validator rejects it and poisons the render context (see the note above
  // `glassMaterial`). FrontSide; flip the consumer's back-face group 180° if a
  // back face is actually visible.
  const params = {
    color: '#87ceeb',
    opacity: 0.3,
    transparent: true,
    side: THREE.FrontSide,
  }
  const material =
    shading === 'solid'
      ? new MeshLambertNodeMaterial(params)
      : new MeshStandardNodeMaterial({
          ...params,
          roughness: 0.1,
          metalness: 0.1,
        })
  defaultMaterialCache.set(cacheKey, material)
  return material
}

export function DEFAULT_CEILING_MATERIAL(shading: RenderShading = 'rendered'): THREE.Material {
  return cachedDefaultMaterial('ceiling', '#f5f5dc', 0.95, shading)
}

export function DEFAULT_ROOF_MATERIAL(shading: RenderShading = 'rendered'): THREE.Material {
  return cachedDefaultMaterial('roof', '#808080', 0.85, shading)
}

export function DEFAULT_SHELF_MATERIAL(shading: RenderShading = 'rendered'): THREE.Material {
  return cachedDefaultMaterial('shelf', '#ffffff', 0.9, shading)
}

export function DEFAULT_STAIR_MATERIAL(shading: RenderShading = 'rendered'): THREE.Material {
  return cachedDefaultMaterial('stair', '#ffffff', 0.9, shading)
}

export function disposeMaterial(material: THREE.Material): void {
  material.dispose()
}

export function clearMaterialCache(): void {
  for (const material of materialCache.values()) {
    material.dispose()
  }
  materialCache.clear()

  for (const material of defaultMaterialCache.values()) {
    material.dispose()
  }
  defaultMaterialCache.clear()

  for (const material of surfaceRoleMaterialCache.values()) {
    material.dispose()
  }
  surfaceRoleMaterialCache.clear()

  for (const texture of textureCache.values()) {
    texture.dispose()
  }
  textureCache.clear()
  textureLoadPromises.clear()
}
