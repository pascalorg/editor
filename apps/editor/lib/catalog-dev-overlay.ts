import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssetInput } from '@pascal-app/core'

const OVERLAY_DIR = 'public/catalog-dev'
const OVERLAY_FILE = 'custom-items.json'

export function getDevCatalogOverlayPath(): string {
  return path.join(process.cwd(), OVERLAY_DIR, OVERLAY_FILE)
}

export async function readDevCatalogOverlay(): Promise<AssetInput[]> {
  const filePath = getDevCatalogOverlayPath()
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as AssetInput[]
  } catch {
    return []
  }
}

export async function writeDevCatalogOverlay(items: AssetInput[]): Promise<void> {
  const filePath = getDevCatalogOverlayPath()
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
}

export async function upsertDevCatalogOverlay(entry: AssetInput): Promise<void> {
  const items = await readDevCatalogOverlay()
  const index = items.findIndex((item) => item.id === entry.id)
  if (index >= 0) {
    items[index] = entry
  } else {
    items.push(entry)
  }
  await writeDevCatalogOverlay(items)
}

export async function removeDevCatalogOverlay(id: string): Promise<void> {
  const items = await readDevCatalogOverlay()
  await writeDevCatalogOverlay(items.filter((item) => item.id !== id))
}
