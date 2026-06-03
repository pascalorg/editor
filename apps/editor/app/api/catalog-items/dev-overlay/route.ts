import type { AssetInput } from '@pascal-app/core'
import { NextResponse } from 'next/server'
import { readDevCatalogOverlay, writeDevCatalogOverlay } from '@/lib/catalog-dev-overlay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeCatalogEntry(entry: AssetInput): AssetInput {
  return {
    ...entry,
    offset: entry.offset ?? [0, 0, 0],
    rotation: entry.rotation ?? [0, 0, 0],
    scale: entry.scale ?? [1, 1, 1],
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Dev overlay is only available in development.' }, { status: 403 })
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
