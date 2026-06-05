import type { AssetInput } from '@pascal-app/core'
import { NextResponse } from 'next/server'
import { readDevCatalogOverlay, writeDevCatalogOverlay } from '@/lib/catalog-dev-overlay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function canReadCatalogOverlay(): boolean {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.PASCAL_ALLOW_CATALOG_SOURCE_WRITE === 'true'
  )
}

function normalizeCatalogEntry(entry: AssetInput): AssetInput {
  return {
    ...entry,
    offset: entry.offset ?? [0, 0, 0],
    rotation: entry.rotation ?? [0, 0, 0],
    scale: entry.scale ?? [1, 1, 1],
  }
}

export async function GET() {
  if (!canReadCatalogOverlay()) {
    return NextResponse.json({ error: 'Catalog overlay is disabled for this server.' }, { status: 403 })
  }

  let items = await readDevCatalogOverlay()
  if (items.length === 0) {
    try {
      const { CATALOG_ITEMS } = await import('@pascal-app/editor/catalog')
      items = CATALOG_ITEMS.filter((item) => item.tags?.includes('custom')).map(normalizeCatalogEntry)
      if (items.length > 0) {
        await writeDevCatalogOverlay(items)
      }
    } catch (error) {
      console.warn('[catalog-dev-overlay] bootstrap failed:', error)
    }
  }

  return NextResponse.json({ items })
}
