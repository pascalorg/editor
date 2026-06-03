import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssetInput } from '@pascal-app/core'
import { formatCatalogEntry } from './format-catalog-entry'

const CATALOG_INSERT_MARKER = '\n]\n\n/** Built-in catalog plus user-added'

export function getCatalogItemsFilePath(): string {
  return path.join(
    process.cwd(),
    '../../packages/editor/src/components/ui/item-catalog/catalog-items.tsx',
  )
}

export function getCatalogItemPublicDir(itemId: string): string {
  return path.join(process.cwd(), 'public/items', itemId)
}

export async function readCatalogItemIds(): Promise<Set<string>> {
  const filePath = getCatalogItemsFilePath()
  const content = await readFile(filePath, 'utf8')
  const ids = new Set<string>()
  const pattern = /^\s+id:\s+'([^']+)',/gm
  for (const match of content.matchAll(pattern)) {
    if (match[1]) ids.add(match[1])
  }
  return ids
}

export type PersistCatalogItemFiles = {
  itemId: string
  model: File
  thumbnail?: File | null
  floorPlan?: File | null
}

export type ResolveCatalogAssetsInput = {
  itemId: string
  srcUrl?: string
  thumbnailUrl?: string
  floorPlanUrl?: string
  model?: File | null
  thumbnail?: File | null
  floorPlan?: File | null
}

const DEFAULT_THUMBNAIL = '/icons/couch.png'

export function normalizeCatalogUrl(url: string): string {
  return url.trim()
}

export function isAllowedModelUrl(url: string): boolean {
  const normalized = normalizeCatalogUrl(url)
  if (!normalized) return false
  if (normalized.startsWith('/')) {
    const path = normalized.split('?')[0]?.toLowerCase() ?? ''
    return path.endsWith('.glb') || path.endsWith('.gltf')
  }
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol === 'https:') {
      const path = parsed.pathname.toLowerCase()
      return path.endsWith('.glb') || path.endsWith('.gltf')
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      const path = parsed.pathname.toLowerCase()
      return path.endsWith('.glb') || path.endsWith('.gltf')
    }
  } catch {
    return false
  }
  return false
}

export function isAllowedImageUrl(url: string): boolean {
  const normalized = normalizeCatalogUrl(url)
  if (!normalized) return false
  if (normalized.startsWith('/')) return true
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol === 'https:') return true
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true
    }
  } catch {
    return false
  }
  return false
}

async function persistOptionalImageFiles(
  itemId: string,
  files: { thumbnail?: File | null; floorPlan?: File | null },
): Promise<{ thumbnail?: string; floorPlanUrl?: string }> {
  const dir = getCatalogItemPublicDir(itemId)
  await mkdir(dir, { recursive: true })
  const result: { thumbnail?: string; floorPlanUrl?: string } = {}

  if (files.thumbnail) {
    const thumbExt = files.thumbnail.name.includes('.')
      ? path.extname(files.thumbnail.name).toLowerCase()
      : '.png'
    const thumbName = `thumbnail${thumbExt === '.' ? '.png' : thumbExt}`
    await writeFile(path.join(dir, thumbName), Buffer.from(await files.thumbnail.arrayBuffer()))
    result.thumbnail = `/items/${itemId}/${thumbName}`
  }

  if (files.floorPlan) {
    const fpExt = path.extname(files.floorPlan.name).toLowerCase() || '.png'
    const fpName = `floor-plan${fpExt}`
    await writeFile(path.join(dir, fpName), Buffer.from(await files.floorPlan.arrayBuffer()))
    result.floorPlanUrl = `/items/${itemId}/${fpName}`
  }

  return result
}

export async function resolveCatalogAssets(
  input: ResolveCatalogAssetsInput,
): Promise<{
  src: string
  thumbnail: string
  floorPlanUrl?: string
}> {
  const srcFromUrl = input.srcUrl?.trim()

  if (srcFromUrl) {
    const src = normalizeCatalogUrl(srcFromUrl)
    if (!isAllowedModelUrl(src)) {
      throw new Error('モデル URL は https:// または / で始まる .glb / .gltf である必要があります。')
    }

    let thumbnail = DEFAULT_THUMBNAIL
    const thumbFromUrl = input.thumbnailUrl?.trim()
    if (thumbFromUrl) {
      if (!isAllowedImageUrl(thumbFromUrl)) {
        throw new Error('サムネイル URL は https:// または / で始まる画像である必要があります。')
      }
      thumbnail = normalizeCatalogUrl(thumbFromUrl)
    } else if (input.thumbnail) {
      const saved = await persistOptionalImageFiles(input.itemId, { thumbnail: input.thumbnail })
      thumbnail = saved.thumbnail ?? DEFAULT_THUMBNAIL
    }

    let floorPlanUrl: string | undefined
    const floorPlanFromUrl = input.floorPlanUrl?.trim()
    if (floorPlanFromUrl) {
      if (!isAllowedImageUrl(floorPlanFromUrl)) {
        throw new Error('平面図 URL は https:// または / で始まる画像である必要があります。')
      }
      floorPlanUrl = normalizeCatalogUrl(floorPlanFromUrl)
    } else if (input.floorPlan) {
      const saved = await persistOptionalImageFiles(input.itemId, { floorPlan: input.floorPlan })
      floorPlanUrl = saved.floorPlanUrl
    }

    return { src, thumbnail, floorPlanUrl }
  }

  if (!input.model) {
    throw new Error('モデルファイルをアップロードするか、モデル URL を入力してください。')
  }

  const assets = await persistCatalogItemAssets({
    itemId: input.itemId,
    model: input.model,
    thumbnail: input.thumbnailUrl?.trim() ? null : input.thumbnail,
    floorPlan: input.floorPlanUrl?.trim() ? null : input.floorPlan,
  })

  const thumbFromUrl = input.thumbnailUrl?.trim()
  if (thumbFromUrl) {
    if (!isAllowedImageUrl(thumbFromUrl)) {
      throw new Error('サムネイル URL は https:// または / で始まる画像である必要があります。')
    }
    assets.thumbnail = normalizeCatalogUrl(thumbFromUrl)
  }

  const floorPlanFromUrl = input.floorPlanUrl?.trim()
  if (floorPlanFromUrl) {
    if (!isAllowedImageUrl(floorPlanFromUrl)) {
      throw new Error('平面図 URL は https:// または / で始まる画像である必要があります。')
    }
    assets.floorPlanUrl = normalizeCatalogUrl(floorPlanFromUrl)
  }

  return assets
}

export async function persistCatalogItemAssets({
  itemId,
  model,
  thumbnail,
  floorPlan,
}: PersistCatalogItemFiles): Promise<{
  src: string
  thumbnail: string
  floorPlanUrl?: string
}> {
  const dir = getCatalogItemPublicDir(itemId)
  await mkdir(dir, { recursive: true })

  const modelExt = model.name.toLowerCase().endsWith('.gltf') ? '.gltf' : '.glb'
  const modelName = `model${modelExt}`
  await writeFile(path.join(dir, modelName), Buffer.from(await model.arrayBuffer()))

  let thumbnailPath = DEFAULT_THUMBNAIL
  if (thumbnail) {
    const thumbExt = thumbnail.name.includes('.')
      ? path.extname(thumbnail.name).toLowerCase()
      : '.png'
    const thumbName = `thumbnail${thumbExt === '.' ? '.png' : thumbExt}`
    await writeFile(path.join(dir, thumbName), Buffer.from(await thumbnail.arrayBuffer()))
    thumbnailPath = `/items/${itemId}/${thumbName}`
  }

  let floorPlanUrl: string | undefined
  if (floorPlan) {
    const fpExt = path.extname(floorPlan.name).toLowerCase() || '.png'
    const fpName = `floor-plan${fpExt}`
    await writeFile(path.join(dir, fpName), Buffer.from(await floorPlan.arrayBuffer()))
    floorPlanUrl = `/items/${itemId}/${fpName}`
  }

  return {
    src: `/items/${itemId}/${modelName}`,
    thumbnail: thumbnailPath,
    floorPlanUrl,
  }
}

export async function updateCatalogEntryInSource(
  id: string,
  entry: AssetInput,
): Promise<{ filePath: string; entry: AssetInput }> {
  if (entry.id !== id) {
    throw new Error('エントリ id がリクエストと一致しません。')
  }

  await assertCatalogEntryDeletable(id)

  const filePath = getCatalogItemsFilePath()
  const content = await readFile(filePath, 'utf8')
  const range = findCatalogEntryRange(content, id)
  if (!range) {
    throw new Error(`カタログに id が見つかりません: ${id}`)
  }

  const snippet = formatCatalogEntry(entry)
  if (!snippet.includes('rotation:') || !snippet.includes('scale:')) {
    throw new Error('Catalog entry serialization missing rotation or scale fields.')
  }
  const updated = content.slice(0, range.start) + snippet + content.slice(range.end)
  await writeFile(filePath, updated, 'utf8')
  return { filePath, entry, snippet }
}

export async function resolveCatalogAssetsForUpdate(
  input: ResolveCatalogAssetsInput & {
    existingSrc?: string
    existingThumbnail?: string
    existingFloorPlanUrl?: string
  },
): Promise<{
  src: string
  thumbnail: string
  floorPlanUrl?: string
}> {
  if (input.model || input.srcUrl?.trim()) {
    return resolveCatalogAssets(input)
  }

  const src = input.existingSrc?.trim()
  if (!src) {
    throw new Error('モデル URL を残すか、新しい .glb / .gltf をアップロードしてください。')
  }

  let thumbnail = input.existingThumbnail?.trim() || DEFAULT_THUMBNAIL
  const thumbFromUrl = input.thumbnailUrl?.trim()
  if (thumbFromUrl) {
    if (!isAllowedImageUrl(thumbFromUrl)) {
      throw new Error('サムネイル URL は https:// または / で始まる画像である必要があります。')
    }
    thumbnail = normalizeCatalogUrl(thumbFromUrl)
  } else if (input.thumbnail) {
    const saved = await persistOptionalImageFiles(input.itemId, { thumbnail: input.thumbnail })
    thumbnail = saved.thumbnail ?? thumbnail
  }

  let floorPlanUrl = input.existingFloorPlanUrl?.trim() || undefined
  const floorPlanFromUrl = input.floorPlanUrl?.trim()
  if (floorPlanFromUrl) {
    if (!isAllowedImageUrl(floorPlanFromUrl)) {
      throw new Error('平面図 URL は https:// または / で始まる画像である必要があります。')
    }
    floorPlanUrl = normalizeCatalogUrl(floorPlanFromUrl)
  } else if (input.floorPlan) {
    const saved = await persistOptionalImageFiles(input.itemId, { floorPlan: input.floorPlan })
    floorPlanUrl = saved.floorPlanUrl
  }

  return { src, thumbnail, floorPlanUrl }
}

export async function appendCatalogEntryToSource(entry: AssetInput): Promise<{
  filePath: string
  entry: AssetInput
  snippet: string
}> {
  const filePath = getCatalogItemsFilePath()
  const content = await readFile(filePath, 'utf8')
  const markerIndex = content.indexOf(CATALOG_INSERT_MARKER)
  if (markerIndex === -1) {
    throw new Error(
      'catalog-items.tsx structure changed; could not find insertion marker.',
    )
  }

  const snippet = formatCatalogEntry(entry)
  if (!snippet.includes('rotation:') || !snippet.includes('scale:')) {
    throw new Error('Catalog entry serialization missing rotation or scale fields.')
  }
  const updated = content.slice(0, markerIndex) + `\n${snippet}` + content.slice(markerIndex)

  await writeFile(filePath, updated, 'utf8')
  return { filePath, entry, snippet }
}

export function slugifyCatalogId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'custom-item'
}

export async function uniqueCatalogId(name: string, preferredId?: string): Promise<string> {
  const taken = await readCatalogItemIds()
  const base = preferredId?.trim() ? slugifyCatalogId(preferredId) : slugifyCatalogId(name)
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function escapeCatalogIdForSource(id: string): string {
  return id.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Locate a single `CATALOG_ITEMS` object literal by `id` (handles nested `surface: { … }`). */
export function findCatalogEntryRange(
  content: string,
  id: string,
): { start: number; end: number } | null {
  const idNeedle = `id: '${escapeCatalogIdForSource(id)}',`
  const idIndex = content.indexOf(idNeedle)
  if (idIndex === -1) return null

  let start = content.lastIndexOf('\n  {', idIndex)
  if (start === -1) {
    const alt = content.lastIndexOf('  {', idIndex)
    if (alt === -1 || alt > idIndex) return null
    start = alt
  } else {
    start += 1
  }

  let depth = 0
  let end = start
  for (let i = start; i < content.length; i++) {
    const char = content[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        if (content[end] === ',') end += 1
        break
      }
    }
  }

  if (depth !== 0) return null
  return { start, end }
}

export function catalogEntryBlockHasCustomTag(block: string): boolean {
  return /['"]custom['"]/.test(block)
}

export async function assertCatalogEntryDeletable(id: string): Promise<void> {
  const filePath = getCatalogItemsFilePath()
  const content = await readFile(filePath, 'utf8')
  const range = findCatalogEntryRange(content, id)
  if (!range) {
    throw new Error(`カタログに id が見つかりません: ${id}`)
  }
  const block = content.slice(range.start, range.end)
  if (!catalogEntryBlockHasCustomTag(block)) {
    throw new Error('custom タグ付きカスタムエントリのみ削除できます。組み込み家具は削除できません。')
  }
}

export async function removeCatalogEntryFromSource(id: string): Promise<{
  filePath: string
  id: string
}> {
  await assertCatalogEntryDeletable(id)

  const filePath = getCatalogItemsFilePath()
  const content = await readFile(filePath, 'utf8')
  const range = findCatalogEntryRange(content, id)
  if (!range) {
    throw new Error(`カタログに id が見つかりません: ${id}`)
  }

  const updated = content.slice(0, range.start) + content.slice(range.end)
  await writeFile(filePath, updated, 'utf8')
  return { filePath, id }
}

export async function removeCatalogItemPublicDir(itemId: string): Promise<void> {
  const dir = getCatalogItemPublicDir(itemId)
  await rm(dir, { recursive: true, force: true })
}
