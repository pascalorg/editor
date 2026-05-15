import {
  type MaterialPresetPayload,
  type MaterialTarget,
  MaterialTarget as MaterialTargetSchema,
} from './schema/material'

export type MaterialCatalogItem = {
  id: string
  label: string
  category: MaterialCategory
  description?: string
  previewThumbnailUrl?: string
  previewColor?: string
  preset: MaterialPresetPayload
}

const WALL_TARGETS: MaterialTarget[] = [MaterialTargetSchema.enum.wall]

const SLAB_TARGETS: MaterialTarget[] = [MaterialTargetSchema.enum.slab]

const WALL_AND_SLAB_TARGETS: MaterialTarget[] = [
  MaterialTargetSchema.enum.wall,
  MaterialTargetSchema.enum.slab,
]

const STAIR_TARGETS: MaterialTarget[] = [
  MaterialTargetSchema.enum.stair,
  MaterialTargetSchema.enum['stair-segment'],
]

const STAIR_AND_FENCE_TARGETS: MaterialTarget[] = [
  ...STAIR_TARGETS,
  MaterialTargetSchema.enum.fence,
]

const ROOF_TARGETS: MaterialTarget[] = [
  MaterialTargetSchema.enum.roof,
  MaterialTargetSchema.enum['roof-segment'],
]

const CEILING_TARGETS: MaterialTarget[] = [MaterialTargetSchema.enum.ceiling]

export const MATERIAL_CATEGORIES = ['wood', 'flooring', 'roof', 'other'] as const
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

export const MATERIAL_CATALOG: MaterialCatalogItem[] = [
  {
    id: 'wall-wood1',
    label: 'Wood',
    category: 'wood',
    description: 'Warm wood finish',
    previewThumbnailUrl: '/material/wood1/wood1_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/wood1/albedoMap_basecolor.jpg',
        normalMap: '/material/wood1/normalMap_normal.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.575,
        metalness: 0,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0.02,
        transparent: true,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'wall-wood2',
    label: 'Wood',
    category: 'wood',
    description: 'Textured wood finish',
    previewThumbnailUrl: '/material/wood2/wood2_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/wood2/albedoMap_Wood.jpg',
        normalMap: '/material/wood2/normalMap_Wood.jpg',
        aoMap: '/material/wood2/aoMap_Wood.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.467,
        metalness: 0,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 2,
        normalScaleY: 2,
        emissiveIntensity: 1,
        displacementScale: 0.02,
        transparent: true,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 2,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'wall-wood3',
    label: 'Wood',
    category: 'wood',
    description: 'Knotted timber finish',
    previewThumbnailUrl: '/material/wood3/wood3_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/wood3/albedoMap_knotted-timber.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.489,
        metalness: 0,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 0.2,
        normalScaleY: 0.2,
        emissiveIntensity: 1,
        displacementScale: 0.02,
        transparent: true,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 2,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'wall-wood4',
    label: 'Wood',
    category: 'wood',
    description: 'Oak stretcher finish',
    previewThumbnailUrl: '/material/wood4/wood4_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/wood4/albedoMap_oak-stretcher.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.378,
        metalness: 0,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0.02,
        transparent: true,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'wall-wood5',
    label: 'Wood',
    category: 'wood',
    description: 'Rich grain wood finish',
    previewThumbnailUrl: '/material/wood5/wood5_thumnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/wood5/albedoMap_3_base_color.webp',
        normalMap: '/material/wood5/normalMap_3_normal.jpg',
        aoMap: '/material/wood5/aoMap_3_ao.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.6,
        metalness: 0,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0.02,
        transparent: true,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 10,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'roof-classicshingles',
    label: 'Classic Shingles',
    category: 'roof',
    description: 'Classic roof shingle finish',
    previewThumbnailUrl: '/material/roof_shingles_classic/roof_shingles_classic_basecolor.webp',
    preset: {
      maps: {
        albedoMap: '/material/roof_shingles_classic/roof_shingles_classic_basecolor.webp',
        aoMap: '/material/roof_shingles_classic/roof_shingles_classic_ambientocclusion.webp',
        metalnessMap: '/material/roof_shingles_classic/roof_shingles_classic_metallic.webp',
        normalMap: '/material/roof_shingles_classic/roof_shingles_classic_normal.webp',
        roughnessMap: '/material/roof_shingles_classic/roof_shingles_classic_roughness.webp',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 1,
        metalness: 0.15,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0,
        transparent: false,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'roof-claytiles',
    label: 'Clay Tiles',
    category: 'roof',
    description: 'Clay roof tile finish',
    previewThumbnailUrl: '/material/roof_tiles_clay/roof_tiles_clay_basecolor.webp',
    preset: {
      maps: {
        albedoMap: '/material/roof_tiles_clay/roof_tiles_clay_basecolor.webp',
        aoMap: '/material/roof_tiles_clay/roof_tiles_clay_ambientocclusion.webp',
        metalnessMap: '/material/roof_tiles_clay/roof_tiles_clay_metallic.png',
        normalMap: '/material/roof_tiles_clay/roof_tiles_clay_normal.webp',
        roughnessMap: '/material/roof_tiles_clay/roof_tiles_clay_roughness.webp',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 1,
        metalness: 0.1,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0,
        transparent: false,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'roof-terracottatiles',
    label: 'Terracotta Tiles',
    category: 'roof',
    description: 'Terracotta roof tile finish',
    previewThumbnailUrl: '/material/roof_tiles_terracotta/roof_tiles_terracotta_basecolor.webp',
    preset: {
      maps: {
        albedoMap: '/material/roof_tiles_terracotta/roof_tiles_terracotta_basecolor.webp',
        aoMap: '/material/roof_tiles_terracotta/roof_tiles_terracotta_ambientocclusion.webp',
        metalnessMap: '/material/roof_tiles_terracotta/roof_tiles_terracotta_metallic.webp',
        normalMap: '/material/roof_tiles_terracotta/roof_tiles_terracotta_normal.webp',
        roughnessMap: '/material/roof_tiles_terracotta/roof_tiles_terracotta_roughness.webp',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 1,
        metalness: 0.1,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0,
        transparent: false,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'roof-weatheredshingles',
    label: 'Weathered Shingles',
    category: 'roof',
    description: 'Weathered roof shingle finish',
    previewThumbnailUrl: '/material/roof_shingles_weathered/roof_shingles_weathered_basecolor.webp',
    preset: {
      maps: {
        albedoMap: '/material/roof_shingles_weathered/roof_shingles_weathered_basecolor.webp',
        aoMap: '/material/roof_shingles_weathered/roof_shingles_weathered_ambientocclusion.webp',
        metalnessMap: '/material/roof_shingles_weathered/roof_shingles_weathered_metallic.webp',
        normalMap: '/material/roof_shingles_weathered/roof_shingles_weathered_normal.webp',
        roughnessMap: '/material/roof_shingles_weathered/roof_shingles_weathered_roughness.webp',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 1,
        metalness: 0.1,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0,
        transparent: false,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'preset-white',
    label: 'White',
    category: 'other',
    description: 'Clean painted finish',
    previewColor: '#ffffff',
    preset: {
      maps: {},
      mapProperties: {
        color: '#ffffff',
        roughness: 0.9,
        metalness: 0,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0.02,
        transparent: false,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'preset-metal',
    label: 'Metal',
    category: 'other',
    description: 'Brushed metal finish',
    previewColor: '#c0c0c0',
    preset: {
      maps: {},
      mapProperties: {
        color: '#c7ccd2',
        roughness: 0.26,
        metalness: 0.82,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0.02,
        transparent: false,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'preset-glass',
    label: 'Glass',
    category: 'other',
    description: 'Light glass finish',
    previewColor: '#87ceeb',
    preset: {
      maps: {},
      mapProperties: {
        color: '#87ceeb',
        roughness: 0.1,
        metalness: 0.1,
        repeatX: 1,
        repeatY: 1,
        rotation: 0,
        wrapS: 'Repeat',
        wrapT: 'Repeat',
        normalScaleX: 1,
        normalScaleY: 1,
        emissiveIntensity: 1,
        displacementScale: 0.02,
        transparent: true,
        flipY: true,
        bumpScale: 1,
        emissiveColor: '#000000',
        aoMapIntensity: 1,
        side: 2,
        opacity: 0.3,
        lightMapIntensity: 1,
      },
    },
  },
]

export function getMaterialsForCategory(category: MaterialCategory): MaterialCatalogItem[] {
  return MATERIAL_CATALOG.filter((item) => item.category === category)
}

export function getCatalogMaterialById(id?: string): MaterialCatalogItem | undefined {
  if (!id) return undefined
  return MATERIAL_CATALOG.find((item) => item.id === id)
}

export const LIBRARY_MATERIAL_REF_PREFIX = 'library:'

export function toLibraryMaterialRef(id: string) {
  return `${LIBRARY_MATERIAL_REF_PREFIX}${id}`
}

export function getLibraryMaterialIdFromRef(materialRef?: string | null) {
  if (!materialRef) return null
  if (!materialRef.startsWith(LIBRARY_MATERIAL_REF_PREFIX)) return null
  return materialRef.slice(LIBRARY_MATERIAL_REF_PREFIX.length)
}

export function getMaterialPresetByRef(materialRef?: string | null): MaterialPresetPayload | null {
  const materialId = getLibraryMaterialIdFromRef(materialRef)
  if (!materialId) return null
  return getCatalogMaterialById(materialId)?.preset ?? null
}
