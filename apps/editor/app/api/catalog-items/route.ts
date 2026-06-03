import type { AssetInput } from '@pascal-app/core'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { upsertDevCatalogOverlay, removeDevCatalogOverlay } from '@/lib/catalog-dev-overlay'
import {
  appendCatalogEntryToSource,
  removeCatalogEntryFromSource,
  removeCatalogItemPublicDir,
  resolveCatalogAssets,
  resolveCatalogAssetsForUpdate,
  uniqueCatalogId,
  updateCatalogEntryInSource,
} from '@/lib/catalog-items-fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const metadataSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  dimensions: z.tuple([z.number(), z.number(), z.number()]),
  offset: z.tuple([z.number(), z.number(), z.number()]).optional(),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
  scale: z.tuple([z.number(), z.number(), z.number()]).optional(),
  attachTo: z.enum(['wall', 'wall-side', 'ceiling']).optional(),
  surfaceHeight: z.number().positive().optional(),
  srcUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  floorPlanUrl: z.string().optional(),
})

function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'カタログのソース書き込みは開発環境でのみ利用できます。' },
      { status: 403 },
    )
  }
  return null
}

export async function POST(request: Request) {
  const blocked = devOnly()
  if (blocked) return blocked

  try {
    const form = await request.formData()

    const metadataRaw = form.get('metadata')
    if (typeof metadataRaw !== 'string') {
      return NextResponse.json({ error: 'metadata JSON がありません。' }, { status: 400 })
    }

    const parsed = metadataSchema.safeParse(JSON.parse(metadataRaw))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'metadata が無効です。', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const model = form.get('model')
    const modelFile = model instanceof File && model.size > 0 ? model : null
    const thumb = form.get('thumbnail')
    const thumbnailFile = thumb instanceof File && thumb.size > 0 ? thumb : null
    const floorPlan = form.get('floorPlan')
    const floorPlanFile = floorPlan instanceof File && floorPlan.size > 0 ? floorPlan : null

    const meta = parsed.data
    const itemId = await uniqueCatalogId(meta.name, meta.id)

    if (modelFile) {
      const lower = modelFile.name.toLowerCase()
      if (!(lower.endsWith('.glb') || lower.endsWith('.gltf'))) {
        return NextResponse.json({ error: 'モデルは .glb または .gltf である必要があります。' }, { status: 400 })
      }
    }

    const assets = await resolveCatalogAssets({
      itemId,
      srcUrl: meta.srcUrl,
      thumbnailUrl: meta.thumbnailUrl,
      floorPlanUrl: meta.floorPlanUrl,
      model: modelFile,
      thumbnail: thumbnailFile,
      floorPlan: floorPlanFile,
    })

    const entry: AssetInput = {
      id: itemId,
      category: meta.category,
      name: meta.name,
      tags: meta.tags?.length ? meta.tags : ['floor', 'custom'],
      thumbnail: assets.thumbnail,
      src: assets.src,
      ...(assets.floorPlanUrl ? { floorPlanUrl: assets.floorPlanUrl } : {}),
      dimensions: meta.dimensions,
      offset: meta.offset ?? [0, 0, 0],
      rotation: meta.rotation ?? [0, 0, 0],
      scale: meta.scale ?? [1, 1, 1],
      ...(meta.attachTo ? { attachTo: meta.attachTo } : {}),
      ...(meta.surfaceHeight !== undefined ? { surface: { height: meta.surfaceHeight } } : {}),
    }

    const result = await appendCatalogEntryToSource(entry)
    await upsertDevCatalogOverlay(entry)

    const usedRemoteUrls = Boolean(meta.srcUrl?.trim())
    return NextResponse.json({
      ok: true,
      entry: result.entry,
      filePath: result.filePath,
      message: usedRemoteUrls
        ? 'catalog-items.tsx に追加しました（入力 URL を使用、public/ へはコピーしません）。サイドバーにすぐ表示されます。'
        : 'catalog-items.tsx に追加しました。サイドバーに表示。アセットは apps/editor/public/items/ にあります。',
    })
  } catch (error) {
    console.error('[catalog-items] write failed:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'カタログエントリの書き込みに失敗しました。',
      },
      { status: 500 },
    )
  }
}

const updateMetadataSchema = metadataSchema.extend({
  id: z.string().min(1),
  existingSrc: z.string().optional(),
  existingThumbnail: z.string().optional(),
  existingFloorPlanUrl: z.string().optional(),
})

export async function PATCH(request: Request) {
  const blocked = devOnly()
  if (blocked) return blocked

  try {
    const form = await request.formData()
    const metadataRaw = form.get('metadata')
    if (typeof metadataRaw !== 'string') {
      return NextResponse.json({ error: 'metadata JSON がありません。' }, { status: 400 })
    }

    const parsed = updateMetadataSchema.safeParse(JSON.parse(metadataRaw))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'metadata が無効です。', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const model = form.get('model')
    const modelFile = model instanceof File && model.size > 0 ? model : null
    const thumb = form.get('thumbnail')
    const thumbnailFile = thumb instanceof File && thumb.size > 0 ? thumb : null
    const floorPlan = form.get('floorPlan')
    const floorPlanFile = floorPlan instanceof File && floorPlan.size > 0 ? floorPlan : null

    const meta = parsed.data
    const itemId = meta.id

    if (modelFile) {
      const lower = modelFile.name.toLowerCase()
      if (!(lower.endsWith('.glb') || lower.endsWith('.gltf'))) {
        return NextResponse.json({ error: 'モデルは .glb または .gltf である必要があります。' }, { status: 400 })
      }
    }

    const assets = await resolveCatalogAssetsForUpdate({
      itemId,
      srcUrl: meta.srcUrl,
      thumbnailUrl: meta.thumbnailUrl,
      floorPlanUrl: meta.floorPlanUrl,
      model: modelFile,
      thumbnail: thumbnailFile,
      floorPlan: floorPlanFile,
      existingSrc: meta.existingSrc,
      existingThumbnail: meta.existingThumbnail,
      existingFloorPlanUrl: meta.existingFloorPlanUrl,
    })

    const entry: AssetInput = {
      id: itemId,
      category: meta.category,
      name: meta.name,
      tags: meta.tags?.length ? meta.tags : ['floor', 'custom'],
      thumbnail: assets.thumbnail,
      src: assets.src,
      ...(assets.floorPlanUrl ? { floorPlanUrl: assets.floorPlanUrl } : {}),
      dimensions: meta.dimensions,
      offset: meta.offset ?? [0, 0, 0],
      rotation: meta.rotation ?? [0, 0, 0],
      scale: meta.scale ?? [1, 1, 1],
      ...(meta.attachTo ? { attachTo: meta.attachTo } : {}),
      ...(meta.surfaceHeight !== undefined ? { surface: { height: meta.surfaceHeight } } : {}),
    }

    const result = await updateCatalogEntryInSource(itemId, entry)
    await upsertDevCatalogOverlay(entry)

    return NextResponse.json({
      ok: true,
      entry: result.entry,
      filePath: result.filePath,
      message: `catalog-items.tsx の「${entry.name}」を更新しました（id: ${itemId}）。`,
    })
  } catch (error) {
    console.error('[catalog-items] update failed:', error)
    const message = error instanceof Error ? error.message : 'カタログエントリの更新に失敗しました。'
    const status =
      message.includes('削除できません') ||
      message.includes('見つかりません') ||
      message.includes('一致しません')
        ? 400
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: Request) {
  const blocked = devOnly()
  if (blocked) return blocked

  try {
    const id = new URL(request.url).searchParams.get('id')?.trim()
    if (!id) {
      return NextResponse.json({ error: 'id クエリパラメータがありません。' }, { status: 400 })
    }

    const result = await removeCatalogEntryFromSource(id)
    await removeCatalogItemPublicDir(id)
    await removeDevCatalogOverlay(id)

    return NextResponse.json({
      ok: true,
      id: result.id,
      filePath: result.filePath,
      message: `catalog-items.tsx から「${id}」を削除しました。サイドバーを更新しました。`,
    })
  } catch (error) {
    console.error('[catalog-items] delete failed:', error)
    const message = error instanceof Error ? error.message : 'カタログエントリの削除に失敗しました。'
    const status =
      message.includes('削除できません') || message.includes('見つかりません') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
