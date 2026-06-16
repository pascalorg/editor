import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AssetInput } from '@pascal-app/core'

export type GeneratedAssetManifestEntry = AssetInput & {
  id: string
  source: 'mine'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function exists(filePath: string) {
  try {
    await fs.access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function findRepoRoot() {
  let current = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    const hasRootShape =
      (await exists(path.join(current, 'package.json'))) &&
      (await exists(path.join(current, 'apps', 'editor', 'public')))
    if (hasRootShape) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return process.cwd()
}

export function itemRoot(repoRoot: string) {
  return path.join(repoRoot, 'apps', 'editor', 'public', 'items')
}

export function generatedManifestPath(repoRoot: string) {
  return path.join(itemRoot(repoRoot), 'generated-assets.json')
}

export function sanitizeSegment(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

export function createGeneratedAssetId(kind: string, label: string) {
  const safeKind = sanitizeSegment(kind, 'generated')
  const safeLabel = sanitizeSegment(label, 'asset')
  return `${safeKind}-${safeLabel}-${randomUUID().slice(0, 8)}`
}

export async function readGeneratedAssets(
  manifestPath: string,
): Promise<GeneratedAssetManifestEntry[]> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed.filter(isRecord) as GeneratedAssetManifestEntry[]) : []
  } catch {
    return []
  }
}

export async function writeGeneratedAssets(
  manifestPath: string,
  assets: GeneratedAssetManifestEntry[],
) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  const tmp = `${manifestPath}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(assets, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, manifestPath)
}

export async function upsertGeneratedAsset(
  manifestPath: string,
  asset: GeneratedAssetManifestEntry,
) {
  const manifest = await readGeneratedAssets(manifestPath)
  await writeGeneratedAssets(manifestPath, [
    asset,
    ...manifest.filter((item) => item.id !== asset.id),
  ])
}

export async function removeGeneratedAsset(manifestPath: string, assetId: string) {
  const manifest = await readGeneratedAssets(manifestPath)
  const nextManifest = manifest.filter((item) => item.id !== assetId)
  if (nextManifest.length === manifest.length) return false
  await writeGeneratedAssets(manifestPath, nextManifest)
  return true
}

export function isSafeGeneratedAssetId(assetId: string) {
  return sanitizeSegment(assetId, '') === assetId && !assetId.includes('/') && !assetId.includes('\\')
}

export async function removeGeneratedAssetDirectory(repoRoot: string, assetId: string) {
  if (!isSafeGeneratedAssetId(assetId)) {
    throw new Error('Invalid asset id')
  }
  const root = itemRoot(repoRoot)
  const assetDir = path.resolve(root, assetId)
  const resolvedRoot = path.resolve(root)
  if (!(assetDir === resolvedRoot || assetDir.startsWith(`${resolvedRoot}${path.sep}`))) {
    throw new Error('Asset directory escapes item root')
  }
  await fs.rm(assetDir, { recursive: true, force: true })
}
