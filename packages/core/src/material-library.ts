import {
  type MaterialPresetPayload,
  type MaterialTarget,
  MaterialTarget as MaterialTargetSchema,
} from './schema/material'

export type MaterialCatalogItem = {
  id: string
  label: string
  description?: string
  targets: MaterialTarget[]
  previewThumbnailUrl?: string
  previewColor?: string
  preset: MaterialPresetPayload
}

const WALL_TARGETS: MaterialTarget[] = [
  MaterialTargetSchema.enum.wall,
]

const SLAB_TARGETS: MaterialTarget[] = [
  MaterialTargetSchema.enum.slab,
]

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

const CEILING_TARGETS: MaterialTarget[] = [
  MaterialTargetSchema.enum.ceiling,
]

export const MATERIAL_CATALOG: MaterialCatalogItem[] = [
  {
    id: 'wall-wood1',
    label: 'Wood',
    description: 'Warm wood finish',
    targets: [...WALL_TARGETS, ...SLAB_TARGETS, ...STAIR_AND_FENCE_TARGETS, ...ROOF_TARGETS],
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
    description: 'Textured wood finish',
    targets: [...WALL_TARGETS, ...SLAB_TARGETS, ...STAIR_AND_FENCE_TARGETS, ...ROOF_TARGETS],
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
    description: 'Knotted timber finish',
    targets: [...WALL_TARGETS, ...SLAB_TARGETS, ...STAIR_AND_FENCE_TARGETS, ...ROOF_TARGETS],
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
    description: 'Oak stretcher finish',
    targets: [...WALL_TARGETS, ...SLAB_TARGETS, ...STAIR_AND_FENCE_TARGETS],
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
    description: 'Rich grain wood finish',
    targets: [...WALL_TARGETS, ...SLAB_TARGETS, ...STAIR_AND_FENCE_TARGETS],
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
    id: 'wall-granite1',
    label: 'Granite',
    description: 'Polished granite finish',
    targets: SLAB_TARGETS,
    previewThumbnailUrl: '/material/granite1/granite_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/granite1/albedoMap_Granite.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.189,
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
    id: 'wall-marble1',
    label: 'Marble',
    description: 'Smooth marble finish',
    targets: [...SLAB_TARGETS, ...STAIR_AND_FENCE_TARGETS],
    previewThumbnailUrl: '/material/marble1/marble1_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/marble1/albedoMap_marble.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.133,
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
    id: 'wall-marble2',
    label: 'Marble',
    description: 'Soft marble finish',
    targets: [...SLAB_TARGETS, ...STAIR_AND_FENCE_TARGETS],
    previewThumbnailUrl: '/material/marble2/marble2_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/marble2/albedoMap_marble.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.122,
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
    id: 'wall-parquet1',
    label: 'Parquet',
    description: 'Parquet wood finish',
    targets: SLAB_TARGETS,
    previewThumbnailUrl: '/material/parquet1/parquet_thumnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/parquet1/albedoMap_parquet.jpg',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.644,
        metalness: 0.4,
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
    id: 'wall-parquet2',
    label: 'Parquet',
    description: 'Soft parquet finish',
    targets: SLAB_TARGETS,
    previewThumbnailUrl: '/material/parquet2/parquet2_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/parquet2/albedoMap_parquet.jpg',
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
        aoMapIntensity: 1,
        side: 0,
        opacity: 1,
        lightMapIntensity: 1,
      },
    },
  },
  {
    id: 'wall-wallpaper1',
    label: 'Wallpaper',
    description: 'Soft wallpaper finish',
    targets: WALL_TARGETS,
    previewThumbnailUrl: '/material/wallpaper1/wallpaper1_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/wallpaper1/albedoMap_1.webp',
        normalMap: '/material/wallpaper1/normalMap_NormalMap.webp',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.911,
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
    id: 'wall-wallpaper2',
    label: 'Wallpaper',
    description: 'Decorative wallpaper finish',
    targets: WALL_TARGETS,
    previewThumbnailUrl: '/material/wallpaper2/wallpaper2_thumnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/wallpaper2/albedoMap_5.webp',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.889,
        metalness: 0.255,
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
    id: 'wall-wallpaper3',
    label: 'Wallpaper',
    description: 'Patterned wallpaper finish',
    targets: WALL_TARGETS,
    previewThumbnailUrl: '/material/wallpaper3/wallpaper3_thumbnail.webp',
    preset: {
      maps: {
        albedoMap: '/material/wallpaper3/albedoMap_wallpaper3.avif',
      },
      mapProperties: {
        color: '#ffffff',
        roughness: 0.887,
        metalness: 0.35,
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
    id: 'preset-white',
    label: 'White',
    description: 'Clean painted finish',
    targets: [
      ...WALL_TARGETS,
      ...SLAB_TARGETS,
      ...ROOF_TARGETS,
      ...STAIR_AND_FENCE_TARGETS,
      ...CEILING_TARGETS,
    ],
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
    description: 'Brushed metal finish',
    targets: [...WALL_TARGETS, ...SLAB_TARGETS],
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
    description: 'Light glass finish',
    targets: [...WALL_TARGETS, ...SLAB_TARGETS],
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

export function getMaterialsForTarget(target: MaterialTarget): MaterialCatalogItem[] {
  return MATERIAL_CATALOG.filter((item) => item.targets.includes(target))
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
