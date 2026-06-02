import type { ItemNode } from '@pascal-app/core'

export type ItemColorMode = 'default' | 'custom'

export const DEFAULT_ITEM_COLOR = '#ffffff'

const ITEM_COLOR_MODE_KEY = 'itemColorMode'
const ITEM_COLOR_KEY = 'itemColor'
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

const getMetadataRecord = (metadata: ItemNode['metadata']): Record<string, unknown> => {
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>
  }
  return {}
}

export const normalizeItemColor = (color: unknown): string | null => {
  if (typeof color !== 'string') return null
  const trimmed = color.trim()
  if (!HEX_COLOR_RE.test(trimmed)) return null
  return trimmed.toLowerCase()
}

export const getItemColorOverride = (node: Pick<ItemNode, 'metadata'>): string | null => {
  const metadata = getMetadataRecord(node.metadata)
  if (metadata[ITEM_COLOR_MODE_KEY] !== 'custom') return null
  return normalizeItemColor(metadata[ITEM_COLOR_KEY])
}

export const getItemColorMode = (node: Pick<ItemNode, 'metadata'>): ItemColorMode =>
  getItemColorOverride(node) ? 'custom' : 'default'

export const createItemColorMetadata = (
  node: Pick<ItemNode, 'metadata'>,
  mode: ItemColorMode,
  color?: string,
): ItemNode['metadata'] => {
  const metadata = { ...getMetadataRecord(node.metadata) }

  if (mode === 'default') {
    delete metadata[ITEM_COLOR_MODE_KEY]
    delete metadata[ITEM_COLOR_KEY]
    return metadata as ItemNode['metadata']
  }

  metadata[ITEM_COLOR_MODE_KEY] = 'custom'
  metadata[ITEM_COLOR_KEY] = normalizeItemColor(color) ?? DEFAULT_ITEM_COLOR
  return metadata as ItemNode['metadata']
}

export const isImportedGlbAsset = (node: Pick<ItemNode, 'asset'>): boolean => {
  const tags = node.asset.tags ?? []
  const src = String(node.asset.src)
  return (
    (tags.includes('imported') && tags.includes('glb')) ||
    (tags.includes('generated') && tags.includes('image-to-3d')) ||
    node.asset.id.startsWith('imported-glb-') ||
    node.asset.id.startsWith('image-to-3d-') ||
    src.includes('/items/imported-glb-') ||
    src.includes('/items/image-to-3d-')
  )
}
