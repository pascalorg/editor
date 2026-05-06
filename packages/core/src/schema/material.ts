import { z } from 'zod'
import { AssetUrl } from './asset-url'

export const MaterialPreset = z.enum([
  'white',
  'brick',
  'concrete',
  'wood',
  'glass',
  'metal',
  'plaster',
  'tile',
  'marble',
  'custom',
])
export type MaterialPreset = z.infer<typeof MaterialPreset>

export const MaterialProperties = z.object({
  color: z.string().default('#ffffff'),
  roughness: z.number().min(0).max(1).default(0.5),
  metalness: z.number().min(0).max(1).default(0),
  opacity: z.number().min(0).max(1).default(1),
  transparent: z.boolean().default(false),
  side: z.enum(['front', 'back', 'double']).default('front'),
})
export type MaterialProperties = z.infer<typeof MaterialProperties>

export const MaterialSchema = z.object({
  id: z.string().optional(),
  preset: MaterialPreset.optional(),
  properties: MaterialProperties.optional(),
  texture: z
    .object({
      url: AssetUrl,
      repeat: z.tuple([z.number(), z.number()]).optional(),
      scale: z.number().optional(),
    })
    .optional(),
})
export type MaterialSchema = z.infer<typeof MaterialSchema>

export const MaterialTarget = z.enum([
  'wall',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'fence',
  'column',
  'slab',
  'ceiling',
  'door',
  'window',
])
export type MaterialTarget = z.infer<typeof MaterialTarget>

export const TextureWrapMode = z.enum(['Repeat', 'ClampToEdge', 'MirroredRepeat'])
export type TextureWrapMode = z.infer<typeof TextureWrapMode>

export const MaterialMapsSchema = z.object({
  albedoMap: AssetUrl.optional(),
  metalnessMap: AssetUrl.optional(),
  roughnessMap: AssetUrl.optional(),
  normalMap: AssetUrl.optional(),
  displacementMap: AssetUrl.optional(),
  aoMap: AssetUrl.optional(),
  emissiveMap: AssetUrl.optional(),
  bumpMap: AssetUrl.optional(),
  alphaMap: AssetUrl.optional(),
  lightMap: AssetUrl.optional(),
})
export type MaterialMaps = z.infer<typeof MaterialMapsSchema>

export const MaterialMapPropertiesSchema = z.object({
  color: z.string().default('#ffffff'),
  roughness: z.number().min(0).max(1).default(0.5),
  metalness: z.number().min(0).max(1).default(0),
  repeatX: z.number().default(1),
  repeatY: z.number().default(1),
  rotation: z.number().default(0),
  wrapS: TextureWrapMode.default('Repeat'),
  wrapT: TextureWrapMode.default('Repeat'),
  normalScaleX: z.number().default(1),
  normalScaleY: z.number().default(1),
  emissiveIntensity: z.number().default(1),
  displacementScale: z.number().default(0.02),
  transparent: z.boolean().default(false),
  flipY: z.boolean().default(true),
  bumpScale: z.number().default(1),
  emissiveColor: z.string().default('#000000'),
  aoMapIntensity: z.number().default(1),
  side: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  lightMapIntensity: z.number().default(1),
})
export type MaterialMapProperties = z.infer<typeof MaterialMapPropertiesSchema>

export const MaterialPresetPayloadSchema = z.object({
  maps: MaterialMapsSchema,
  mapProperties: MaterialMapPropertiesSchema,
})
export type MaterialPresetPayload = z.infer<typeof MaterialPresetPayloadSchema>

export const DEFAULT_MATERIALS: Record<MaterialPreset, MaterialProperties> = {
  white: {
    color: '#ffffff',
    roughness: 0.9,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  brick: {
    color: '#8b4513',
    roughness: 0.85,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  concrete: {
    color: '#808080',
    roughness: 0.8,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  wood: {
    color: '#deb887',
    roughness: 0.7,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  glass: {
    color: '#87ceeb',
    roughness: 0.1,
    metalness: 0.1,
    opacity: 0.3,
    transparent: true,
    side: 'double',
  },
  metal: {
    color: '#c0c0c0',
    roughness: 0.3,
    metalness: 0.9,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  plaster: {
    color: '#f5f5dc',
    roughness: 0.95,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  tile: {
    color: '#d3d3d3',
    roughness: 0.4,
    metalness: 0.1,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  marble: {
    color: '#fafafa',
    roughness: 0.2,
    metalness: 0.1,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
  custom: {
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
}

export function resolveMaterial(material?: MaterialSchema): MaterialProperties {
  if (!material) {
    return DEFAULT_MATERIALS.white
  }

  if (material.preset && material.preset !== 'custom') {
    const presetProps = DEFAULT_MATERIALS[material.preset]
    return {
      ...presetProps,
      ...material.properties,
    }
  }

  return {
    ...DEFAULT_MATERIALS.custom,
    ...material.properties,
  }
}
