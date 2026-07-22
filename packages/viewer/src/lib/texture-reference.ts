import type * as THREE from 'three'
import { ASSETS_CDN_URL } from './asset-url'

export type PascalTextureMap =
  | 'basecolor'
  | 'normal'
  | 'roughness'
  | 'metalness'
  | 'height'
  | 'other'

export type PascalTextureColorSpace = 'srgb' | 'linear'

type PascalTextureRefBase = {
  v: 1
  src: string
  map: PascalTextureMap
  colorSpace: PascalTextureColorSpace
}

export type PascalTextureRef =
  | (PascalTextureRefBase & {
      kind: 'library-material' | 'app-material' | 'project-asset'
    })
  | (PascalTextureRefBase & {
      kind: 'item-glb'
      imageIndex: number
    })

const STORAGE_BUCKET_BY_KIND = {
  'library-material': 'materials',
  'item-glb': 'items',
  'project-asset': 'project-assets',
} as const

let cachedStorageOrigin: string | null | undefined
function pascalStorageOrigin(): string | null {
  if (cachedStorageOrigin !== undefined) return cachedStorageOrigin
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    cachedStorageOrigin = url ? new URL(url).origin : null
  } catch {
    cachedStorageOrigin = null
  }
  return cachedStorageOrigin
}

/** Static catalog materials ship in the app's public dir and resolve through
 *  the assets CDN (`/material/{category}/{slug}/{slug}_{map}_{size}.ktx2`) —
 *  a server-known KTX2 source like the storage buckets, just app-hosted. */
function isAppMaterialUrl(src: string): boolean {
  try {
    const url = new URL(src)
    return url.origin === new URL(ASSETS_CDN_URL).origin && url.pathname.startsWith('/material/')
  } catch {
    return false
  }
}

const TEXTURE_MAPS = new Set<PascalTextureMap>([
  'basecolor',
  'normal',
  'roughness',
  'metalness',
  'height',
  'other',
])

function isPascalStorageUrl(src: string, kind: keyof typeof STORAGE_BUCKET_BY_KIND): boolean {
  const origin = pascalStorageOrigin()
  if (!origin) return false
  try {
    const url = new URL(src)
    const bucket = STORAGE_BUCKET_BY_KIND[kind]
    return url.origin === origin && url.pathname.startsWith(`/storage/v1/object/public/${bucket}/`)
  } catch {
    return false
  }
}

export function textureMapForSlot(slot: string): PascalTextureMap {
  switch (slot) {
    case 'map':
      return 'basecolor'
    case 'normalMap':
      return 'normal'
    case 'roughnessMap':
      return 'roughness'
    case 'metalnessMap':
      return 'metalness'
    case 'displacementMap':
    case 'bumpMap':
      return 'height'
    default:
      return 'other'
  }
}

function textureColorSpace(texture: THREE.Texture): PascalTextureColorSpace {
  return texture.colorSpace === 'srgb' ? 'srgb' : 'linear'
}

export function stampPascalTextureRef(
  texture: THREE.Texture,
  input:
    | {
        /** 'material' resolves to library-material (storage bucket) or
         *  app-material (static catalog on the assets CDN) by URL shape. */
        kind: 'material' | 'project-asset'
        src: string
        slot: string
      }
    | {
        kind: 'item-glb'
        src: string
        slot: string
        imageIndex: number
      },
): PascalTextureRef | null {
  const base = {
    v: 1 as const,
    src: input.src,
    map: textureMapForSlot(input.slot),
    colorSpace: textureColorSpace(texture),
  }

  let ref: PascalTextureRef
  if (input.kind === 'item-glb') {
    if (!isPascalStorageUrl(input.src, 'item-glb')) return null
    if (!Number.isInteger(input.imageIndex) || input.imageIndex < 0) return null
    ref = { ...base, kind: 'item-glb', imageIndex: input.imageIndex }
  } else {
    const kind =
      input.kind === 'material'
        ? isPascalStorageUrl(input.src, 'library-material')
          ? 'library-material'
          : isAppMaterialUrl(input.src)
            ? 'app-material'
            : null
        : isPascalStorageUrl(input.src, 'project-asset')
          ? 'project-asset'
          : null
    if (!kind) return null
    ref = { ...base, kind }
  }
  texture.userData.pascalTextureRef = ref
  return ref
}

export function getPascalTextureRef(texture: THREE.Texture): PascalTextureRef | null {
  const raw = texture.userData.pascalTextureRef
  if (!raw || typeof raw !== 'object') return null

  const candidate = raw as Record<string, unknown>
  const kind = candidate.kind
  if (
    candidate.v !== 1 ||
    (kind !== 'library-material' &&
      kind !== 'app-material' &&
      kind !== 'item-glb' &&
      kind !== 'project-asset') ||
    typeof candidate.src !== 'string' ||
    !(kind === 'app-material'
      ? isAppMaterialUrl(candidate.src)
      : isPascalStorageUrl(candidate.src, kind)) ||
    typeof candidate.map !== 'string' ||
    !TEXTURE_MAPS.has(candidate.map as PascalTextureMap) ||
    (candidate.colorSpace !== 'srgb' && candidate.colorSpace !== 'linear')
  ) {
    return null
  }

  const base: PascalTextureRefBase = {
    v: 1,
    src: candidate.src,
    map: candidate.map as PascalTextureMap,
    colorSpace: candidate.colorSpace,
  }
  if (kind === 'item-glb') {
    if (!Number.isInteger(candidate.imageIndex) || (candidate.imageIndex as number) < 0) return null
    return { ...base, kind, imageIndex: candidate.imageIndex as number }
  }
  if (candidate.imageIndex !== undefined) return null
  return { ...base, kind }
}
