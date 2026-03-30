import { z } from 'zod'

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
  preset: MaterialPreset.optional(),
  properties: MaterialProperties.optional(),
  texture: z
    .object({
      url: z.string(),
      repeat: z.tuple([z.number(), z.number()]).optional(),
      scale: z.number().optional(),
    })
    .optional(),
})
export type MaterialSchema = z.infer<typeof MaterialSchema>

export const DEFAULT_MATERIALS: Record<MaterialPreset, MaterialProperties> = {
  white: { color: '#ffffff', roughness: 0.9, metalness: 0, opacity: 1, transparent: false, side: 'front' },
  brick: { color: '#8b4513', roughness: 0.85, metalness: 0, opacity: 1, transparent: false, side: 'front' },
  concrete: { color: '#808080', roughness: 0.8, metalness: 0, opacity: 1, transparent: false, side: 'front' },
  wood: { color: '#deb887', roughness: 0.7, metalness: 0, opacity: 1, transparent: false, side: 'front' },
  glass: { color: '#87ceeb', roughness: 0.1, metalness: 0.1, opacity: 0.3, transparent: true, side: 'double' },
  metal: { color: '#c0c0c0', roughness: 0.3, metalness: 0.9, opacity: 1, transparent: false, side: 'front' },
  plaster: { color: '#f5f5dc', roughness: 0.95, metalness: 0, opacity: 1, transparent: false, side: 'front' },
  tile: { color: '#d3d3d3', roughness: 0.4, metalness: 0.1, opacity: 1, transparent: false, side: 'front' },
  marble: { color: '#fafafa', roughness: 0.2, metalness: 0.1, opacity: 1, transparent: false, side: 'front' },
  custom: { color: '#ffffff', roughness: 0.5, metalness: 0, opacity: 1, transparent: false, side: 'front' },
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
