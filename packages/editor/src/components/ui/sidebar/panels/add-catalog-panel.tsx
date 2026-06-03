'use client'

import type { AssetInput } from '@pascal-app/core'
import { FileCode2, Loader2, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  formatCatalogFieldNumber,
  inferCatalogParamsFromGlbUrl,
} from '../../../../lib/infer-glb-catalog-params'
import { getAllCatalogItems } from '../../item-catalog/catalog-items'
import { useCustomCatalog } from '../../item-catalog/custom-catalog-store'
import { useDevCatalogOverlay } from '../../item-catalog/dev-catalog-overlay-store'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import useEditor, { type CatalogCategory } from '../../../../store/use-editor'
import {
  AttachToHint,
  CatalogPlacementFieldGuide,
  DIMENSIONS_HINT,
  OFFSET_HINT,
  ROTATION_HINT,
  SCALE_HINT,
} from './catalog-field-guide'

const CATEGORIES: CatalogCategory[] = [
  'furniture',
  'appliance',
  'kitchen',
  'bathroom',
  'outdoor',
]

const CATEGORY_LABELS_JA: Record<CatalogCategory, string> = {
  furniture: '家具',
  appliance: '家電',
  kitchen: 'キッチン',
  bathroom: 'バスルーム',
  outdoor: 'アウトドア',
  window: '窓',
  door: 'ドア',
}

const isDev = process.env.NODE_ENV === 'development'

function slugifyId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'custom-item'
}

function uniqueCatalogId(name: string, preferred?: string): string {
  const taken = new Set(getAllCatalogItems().map((item) => item.id))
  const base = preferred?.trim() ? slugifyId(preferred) : slugifyId(name)
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function parseDimensions(raw: { w: string; h: string; d: string }): [number, number, number] | null {
  const w = Number.parseFloat(raw.w)
  const h = Number.parseFloat(raw.h)
  const d = Number.parseFloat(raw.d)
  if (![w, h, d].every((value) => Number.isFinite(value) && value > 0)) return null
  return [w, h, d]
}

function parseTuple3(raw: { x: string; y: string; z: string }): [number, number, number] | null {
  const x = Number.parseFloat(raw.x)
  const y = Number.parseFloat(raw.y)
  const z = Number.parseFloat(raw.z)
  if (![x, y, z].every((value) => Number.isFinite(value))) return null
  return [x, y, z]
}

function UrlField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label className="block space-y-1 rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      <Input onChange={(e) => onChange(e.target.value)} placeholder={placeholder} value={value} />
    </label>
  )
}

function TupleFields({
  label,
  values,
  onChange,
  step = '0.01',
}: {
  label: string
  values: { x: string; y: string; z: string }
  onChange: (axis: 'x' | 'y' | 'z', value: string) => void
  step?: string
}) {
  return (
    <div className="space-y-1">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <Input
            inputMode="decimal"
            key={axis}
            onChange={(e) => onChange(axis, e.target.value)}
            placeholder={axis}
            step={step}
            type="number"
            value={values[axis]}
          />
        ))}
      </div>
    </div>
  )
}

function isDeletableCatalogItem(item: AssetInput): boolean {
  return item.tags?.includes('custom') ?? false
}

export function AddCatalogPanel() {
  const setPhase = useEditor((s) => s.setPhase)
  const setMode = useEditor((s) => s.setMode)
  const setTool = useEditor((s) => s.setTool)
  const setCatalogCategory = useEditor((s) => s.setCatalogCategory)
  const selectedItem = useEditor((s) => s.selectedItem)
  const setSelectedItem = useEditor((s) => s.setSelectedItem)
  const setActiveSidebarPanel = useEditor((s) => s.setActiveSidebarPanel)
  const removeCustomCatalogItem = useCustomCatalog((s) => s.removeItem)
  const upsertCustomCatalogItem = useCustomCatalog((s) => s.addItem)
  const customCatalogRevision = useCustomCatalog((s) => s.customItems)
  const devOverlayRevision = useDevCatalogOverlay((s) => s.revision)
  const reloadDevCatalogOverlay = useDevCatalogOverlay((s) => s.reloadFromServer)
  const upsertDevCatalogOverlay = useDevCatalogOverlay((s) => s.upsertItem)
  const removeDevCatalogOverlay = useDevCatalogOverlay((s) => s.removeItem)

  useEffect(() => {
    void reloadDevCatalogOverlay()
  }, [reloadDevCatalogOverlay])

  const [customId, setCustomId] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<CatalogCategory>('furniture')
  const [tagsText, setTagsText] = useState('floor, custom')
  const [dimW, setDimW] = useState('1')
  const [dimH, setDimH] = useState('1')
  const [dimD, setDimD] = useState('1')
  const [offset, setOffset] = useState({ x: '0', y: '0', z: '0' })
  const [rotation, setRotation] = useState({ x: '0', y: '0', z: '0' })
  const [scale, setScale] = useState({ x: '1', y: '1', z: '1' })
  const [surfaceHeight, setSurfaceHeight] = useState('')
  const [attachTo, setAttachTo] = useState<'' | 'wall' | 'wall-side' | 'ceiling'>('')
  const [modelUrl, setModelUrl] = useState('')
  const [thumbnailUrl, setThumbnailUrl] = useState('')
  const [floorPlanUrl, setFloorPlanUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAnalyzingGlb, setIsAnalyzingGlb] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [catalogListKey, setCatalogListKey] = useState(0)
  const [optimisticallyRemovedIds, setOptimisticallyRemovedIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingAssets, setEditingAssets] = useState<{
    src: string
    thumbnail: string
    floorPlanUrl?: string
  } | null>(null)

  const isEditing = editingId !== null

  // Do not memoize: `CATALOG_ITEMS` can change via HMR / manual edits without bumping
  // `catalogListKey`. Re-read every render; `customCatalogRevision` covers post-write upserts.
  void catalogListKey
  void customCatalogRevision
  void devOverlayRevision
  const deletableItems = getAllCatalogItems().filter(
    (item) => isDeletableCatalogItem(item) && !optimisticallyRemovedIds.has(item.id),
  )

  const previewId = useMemo(() => {
    if (editingId) return editingId
    const trimmed = name.trim()
    if (!trimmed) return ''
    return uniqueCatalogId(trimmed, customId)
  }, [customId, editingId, name])

  const resetForm = useCallback(() => {
    setEditingId(null)
    setEditingAssets(null)
    setCustomId('')
    setName('')
    setCategory('furniture')
    setTagsText('floor, custom')
    setDimW('1')
    setDimH('1')
    setDimD('1')
    setOffset({ x: '0', y: '0', z: '0' })
    setRotation({ x: '0', y: '0', z: '0' })
    setScale({ x: '1', y: '1', z: '1' })
    setSurfaceHeight('')
    setAttachTo('')
    setModelUrl('')
    setThumbnailUrl('')
    setFloorPlanUrl('')
    setError(null)
  }, [])

  const startPlacement = useCallback(
    (entry: AssetInput) => {
      setPhase('furnish')
      setMode('build')
      setTool('item')
      setCatalogCategory(entry.category as CatalogCategory)
      setSelectedItem(entry)
      setActiveSidebarPanel('items')
    },
    [setActiveSidebarPanel, setCatalogCategory, setMode, setPhase, setSelectedItem, setTool],
  )

  const applyInferredParams = useCallback(
    (params: Awaited<ReturnType<typeof inferCatalogParamsFromGlbUrl>>) => {
      const [w, h, d] = params.dimensions
      setDimW(formatCatalogFieldNumber(w))
      setDimH(formatCatalogFieldNumber(h))
      setDimD(formatCatalogFieldNumber(d))
      setOffset({
        x: formatCatalogFieldNumber(params.offset[0]),
        y: formatCatalogFieldNumber(params.offset[1]),
        z: formatCatalogFieldNumber(params.offset[2]),
      })
      setRotation({
        x: formatCatalogFieldNumber(params.rotation[0]),
        y: formatCatalogFieldNumber(params.rotation[1]),
        z: formatCatalogFieldNumber(params.rotation[2]),
      })
      setScale({
        x: formatCatalogFieldNumber(params.scale[0]),
        y: formatCatalogFieldNumber(params.scale[1]),
        z: formatCatalogFieldNumber(params.scale[2]),
      })
      setSuccess(`GLB からフィールドを自動入力しました。${params.notes.join(' ')}`)
    },
    [],
  )

  const handleAutoFillFromGlb = useCallback(async () => {
    setError(null)
    setSuccess(null)

    if (!modelUrl.trim()) {
      setError('取得可能なモデル URL（.glb / .gltf）を入力してください。')
      return
    }

    setIsAnalyzingGlb(true)
    try {
      const params = await inferCatalogParamsFromGlbUrl(modelUrl.trim())
      applyInferredParams(params)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'GLB の読み込みに失敗しました。'
      setError(`${message}（外部 URL は CORS が許可されている必要があります）`)
    } finally {
      setIsAnalyzingGlb(false)
    }
  }, [applyInferredParams, modelUrl])

  const loadItemForEdit = useCallback((item: AssetInput) => {
    const [w, h, d] = item.dimensions ?? [1, 1, 1]
    const off = item.offset ?? [0, 0, 0]
    const rot = item.rotation ?? [0, 0, 0]
    const scl = item.scale ?? [1, 1, 1]

    setEditingId(item.id)
    setEditingAssets({
      src: item.src,
      thumbnail: item.thumbnail,
      floorPlanUrl: item.floorPlanUrl,
    })
    setCustomId(item.id)
    setName(item.name)
    setCategory((item.category as CatalogCategory) || 'furniture')
    setTagsText((item.tags ?? ['floor', 'custom']).join(', '))
    setDimW(formatCatalogFieldNumber(w))
    setDimH(formatCatalogFieldNumber(h))
    setDimD(formatCatalogFieldNumber(d))
    setOffset({
      x: formatCatalogFieldNumber(off[0]),
      y: formatCatalogFieldNumber(off[1]),
      z: formatCatalogFieldNumber(off[2]),
    })
    setRotation({
      x: formatCatalogFieldNumber(rot[0]),
      y: formatCatalogFieldNumber(rot[1]),
      z: formatCatalogFieldNumber(rot[2]),
    })
    setScale({
      x: formatCatalogFieldNumber(scl[0]),
      y: formatCatalogFieldNumber(scl[1]),
      z: formatCatalogFieldNumber(scl[2]),
    })
    setSurfaceHeight(
      item.surface?.height !== undefined ? formatCatalogFieldNumber(item.surface.height) : '',
    )
    setAttachTo((item.attachTo as typeof attachTo) ?? '')
    setModelUrl(item.src)
    setThumbnailUrl(item.thumbnail)
    setFloorPlanUrl(item.floorPlanUrl ?? '')
    setError(null)
    setSuccess(`「${item.name}」を編集中です。変更後「変更を保存」をクリックしてください。`)
  }, [])

  const cancelEdit = useCallback(() => {
    resetForm()
    setSuccess(null)
  }, [resetForm])

  const handleDelete = useCallback(
    async (item: AssetInput) => {
      if (!isDev) {
        setError('カタログ項目の削除はローカル開発（bun dev）時のみ利用できます。')
        return
      }

      const confirmed = window.confirm(
        `catalog-items.tsx から「${item.name}」（id: ${item.id}）を削除しますか？\n存在する場合は public/items/${item.id}/ も削除します。`,
      )
      if (!confirmed) return

      setError(null)
      setSuccess(null)
      setDeletingId(item.id)

      try {
        const response = await fetch(`/api/catalog-items?id=${encodeURIComponent(item.id)}`, {
          method: 'DELETE',
        })
        const body = (await response.json()) as { ok?: boolean; message?: string; error?: string }

        if (!response.ok) {
          setError(body.error ?? '削除に失敗しました。')
          return
        }

        setOptimisticallyRemovedIds((prev) => new Set(prev).add(item.id))
        setCatalogListKey((key) => key + 1)
        removeCustomCatalogItem(item.id)
        removeDevCatalogOverlay(item.id)
        void reloadDevCatalogOverlay()
        if (selectedItem?.id === item.id) {
          setSelectedItem(null)
        }
        if (editingId === item.id) {
          resetForm()
        }

        setSuccess(body.message ?? `「${item.name}」を削除しました。`)
      } catch {
        setError('削除リクエストに失敗しました。apps/editor の開発サーバーが起動しているか確認してください。')
      } finally {
        setDeletingId(null)
      }
    },
    [
      editingId,
      removeCustomCatalogItem,
      removeDevCatalogOverlay,
      reloadDevCatalogOverlay,
      resetForm,
      selectedItem?.id,
      setSelectedItem,
    ],
  )

  const handleSubmit = useCallback(async () => {
    setError(null)
    setSuccess(null)

    if (!isDev) {
      setError('ソースへの書き込みはローカル開発（bun dev）時のみ利用できます。')
      return
    }

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('家具名を入力してください。')
      return
    }
    const trimmedModelUrl = modelUrl.trim()
    const hasModelSource = Boolean(trimmedModelUrl) || Boolean(editingAssets?.src)
    if (!hasModelSource) {
      setError('モデル URL（.glb / .gltf）を入力してください。')
      return
    }

    const dimensions = parseDimensions({ w: dimW, h: dimH, d: dimD })
    if (!dimensions) {
      setError('寸法は 0 より大きい数値（メートル）にしてください。')
      return
    }

    const offsetTuple = parseTuple3(offset)
    const rotationTuple = parseTuple3(rotation)
    const scaleTuple = parseTuple3(scale)
    if (!(offsetTuple && rotationTuple && scaleTuple)) {
      setError('offset / rotation / scale は有効な数値にしてください。')
      return
    }

    let surfaceHeightValue: number | undefined
    if (surfaceHeight.trim()) {
      const parsed = Number.parseFloat(surfaceHeight)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('天板の高さは 0 より大きい数値にしてください。')
        return
      }
      surfaceHeightValue = parsed
    }

    const tags = tagsText
      .split(/[,，]/)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)

    const targetId = editingId ?? previewId
    if (!targetId) {
      setError('エントリ ID を確定できません。')
      return
    }

    const metadata = {
      name: trimmedName,
      category,
      id: targetId,
      tags: tags.length > 0 ? tags : ['floor', 'custom'],
      dimensions,
      offset: offsetTuple,
      rotation: rotationTuple,
      scale: scaleTuple,
      ...(attachTo ? { attachTo } : {}),
      ...(surfaceHeightValue !== undefined ? { surfaceHeight: surfaceHeightValue } : {}),
      ...(trimmedModelUrl ? { srcUrl: trimmedModelUrl } : {}),
      ...(thumbnailUrl.trim() ? { thumbnailUrl: thumbnailUrl.trim() } : {}),
      ...(floorPlanUrl.trim() ? { floorPlanUrl: floorPlanUrl.trim() } : {}),
      ...(editingId && editingAssets
        ? {
            existingSrc: editingAssets.src,
            existingThumbnail: editingAssets.thumbnail,
            ...(editingAssets.floorPlanUrl
              ? { existingFloorPlanUrl: editingAssets.floorPlanUrl }
              : {}),
          }
        : {}),
    }

    const form = new FormData()
    form.append('metadata', JSON.stringify(metadata))

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/catalog-items', {
        method: editingId ? 'PATCH' : 'POST',
        body: form,
      })
      const body = (await response.json()) as {
        ok?: boolean
        entry?: AssetInput
        message?: string
        error?: string
      }

      if (!response.ok) {
        setError(body.error ?? '書き込みに失敗しました。')
        return
      }

      if (!body.entry) {
        setError('サーバーからカタログエントリが返されませんでした。')
        return
      }

      upsertCustomCatalogItem(body.entry)
      upsertDevCatalogOverlay(body.entry)
      void reloadDevCatalogOverlay()
      setCatalogListKey((key) => key + 1)
      if (selectedItem?.id === body.entry.id) {
        setSelectedItem(body.entry)
      }

      if (editingId) {
        setSuccess(body.message ?? `「${body.entry.name}」を更新しました。`)
        setEditingAssets({
          src: body.entry.src,
          thumbnail: body.entry.thumbnail,
          floorPlanUrl: body.entry.floorPlanUrl,
        })
        setModelUrl(body.entry.src)
        setThumbnailUrl(body.entry.thumbnail)
        setFloorPlanUrl(body.entry.floorPlanUrl ?? '')
      } else {
        setSuccess(
          body.message ??
            `catalog-items.tsx に書き込みました（id: ${body.entry.id}）。`,
        )
        startPlacement(body.entry)
        resetForm()
      }
    } catch {
      setError('リクエストに失敗しました。apps/editor の開発サーバーが起動しているか確認してください。')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    attachTo,
    category,
    dimD,
    dimH,
    dimW,
    floorPlanUrl,
    modelUrl,
    name,
    offset,
    editingAssets,
    editingId,
    previewId,
    resetForm,
    rotation,
    scale,
    selectedItem?.id,
    setSelectedItem,
    startPlacement,
    surfaceHeight,
    upsertCustomCatalogItem,
    upsertDevCatalogOverlay,
    reloadDevCatalogOverlay,
    tagsText,
    thumbnailUrl,
  ])

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="space-y-1 pb-3">
        <h2 className="font-semibold text-sm">家具カタログへ書き込み</h2>
      </div>

      <div className="space-y-3">
        {isEditing && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-2">
            <p className="text-xs">
              編集中 <span className="font-medium">{name || editingId}</span>
              <span className="text-muted-foreground">（{editingId}）</span>
            </p>
            <Button
              className="h-7 shrink-0 gap-1 px-2"
              onClick={cancelEdit}
              size="sm"
              type="button"
              variant="ghost"
            >
              <X className="size-3.5" />
              キャンセル
            </Button>
          </div>
        )}

        <label className="block space-y-1">
          <span className="font-medium text-muted-foreground text-xs">名称 *</span>
          <Input onChange={(e) => setName(e.target.value)} placeholder="オフィスチェア" value={name} />
        </label>

        <label className="block space-y-1">
          <span className="font-medium text-muted-foreground text-xs">
            ID{isEditing ? '（編集時は変更不可）' : '（任意）'}
          </span>
          <Input
            disabled={isEditing}
            onChange={(e) => setCustomId(e.target.value)}
            placeholder={previewId || 'office-chair'}
            value={customId}
          />
          {previewId && (
            <p className="text-muted-foreground text-[10px]">
              {isEditing ? `エントリ id: ${previewId}` : `書き込み id: ${previewId}`}
            </p>
          )}
        </label>

        <label className="block space-y-1">
          <span className="font-medium text-muted-foreground text-xs">カテゴリ *</span>
          <select
            className="w-full rounded-lg border border-border bg-muted px-2.5 py-2 text-sm"
            onChange={(e) => setCategory(e.target.value as CatalogCategory)}
            value={category}
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS_JA[value]}
              </option>
            ))}
          </select>
        </label>

        <UrlField
          label="モデル src *"
          onChange={setModelUrl}
          placeholder="https://example.com/model.glb"
          value={modelUrl}
        />

        <UrlField
          label="サムネイル thumbnail（任意）"
          onChange={setThumbnailUrl}
          placeholder="https://…/thumbnail.png（空欄はプレースホルダ）"
          value={thumbnailUrl}
        />

        <UrlField
          label="平面図 floorPlanUrl（任意）"
          onChange={setFloorPlanUrl}
          placeholder="https://…/floor-plan.png"
          value={floorPlanUrl}
        />

        <Button
          className="h-10 w-full gap-2 border border-primary/30 bg-primary font-semibold text-primary-foreground shadow-md ring-2 ring-primary/20 hover:bg-primary/90"
          disabled={isAnalyzingGlb || isSubmitting || !modelUrl.trim()}
          onClick={() => void handleAutoFillFromGlb()}
          size="lg"
          type="button"
          variant="default"
        >
          {isAnalyzingGlb ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {isAnalyzingGlb ? '読み込み中…' : 'glb属性自动入力'}
        </Button>
        <p className="text-muted-foreground text-[10px] leading-relaxed">
          バウンディングボックスから推定（ミリ scale、Z-up 回転、床接地 offset）。浮く・向きが違う場合は手動で微調整してください。
        </p>

        <CatalogPlacementFieldGuide />

        <div className="space-y-1">
          <span className="font-medium text-muted-foreground text-xs">寸法 dimensions（m）*</span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['幅', dimW, setDimW],
                ['高', dimH, setDimH],
                ['奥', dimD, setDimD],
              ] as const
            ).map(([label, value, onChange]) => (
              <label className="block space-y-1" key={label}>
                <span className="text-[10px] text-muted-foreground">{label}</span>
                <Input
                  inputMode="decimal"
                  onChange={(e) => onChange(e.target.value)}
                  step="0.01"
                  type="number"
                  value={value}
                />
              </label>
            ))}
          </div>
          {DIMENSIONS_HINT}
        </div>

        <div className="space-y-1">
          <TupleFields
            label="offset（位置補正、メートル）"
            onChange={(axis, value) => setOffset((prev) => ({ ...prev, [axis]: value }))}
            values={offset}
          />
          {OFFSET_HINT}
        </div>
        <div className="space-y-1">
          <TupleFields
            label="rotation（ラジアン）"
            onChange={(axis, value) => setRotation((prev) => ({ ...prev, [axis]: value }))}
            values={rotation}
          />
          {ROTATION_HINT}
        </div>
        <div className="space-y-1">
          <TupleFields
            label="scale（GLB のみ拡大縮小、枠は変わらない）"
            onChange={(axis, value) => setScale((prev) => ({ ...prev, [axis]: value }))}
            step="0.1"
            values={scale}
          />
          {SCALE_HINT}
        </div>

        <label className="block space-y-1">
          <span className="font-medium text-muted-foreground text-xs">天板の高さ surface.height（任意）</span>
          <Input
            inputMode="decimal"
            onChange={(e) => setSurfaceHeight(e.target.value)}
            placeholder="例: 0.35"
            step="0.01"
            type="number"
            value={surfaceHeight}
          />
        </label>

        <label className="block space-y-1">
          <span className="font-medium text-muted-foreground text-xs">取り付け attachTo</span>
          <select
            className="w-full rounded-lg border border-border bg-muted px-2.5 py-2 text-sm"
            onChange={(e) => setAttachTo(e.target.value as typeof attachTo)}
            value={attachTo}
          >
            <option value="">床（フロア）</option>
            <option value="wall">wall — 壁厚の中央・両面占有</option>
            <option value="wall-side">wall-side — 壁面に貼り付け</option>
            <option value="ceiling">ceiling — 天井</option>
          </select>
          <AttachToHint attachTo={attachTo} />
        </label>

        <label className="block space-y-1">
          <span className="font-medium text-muted-foreground text-xs">タグ tags（カンマ区切り）</span>
          <Input
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="floor, chair, custom"
            value={tagsText}
          />
        </label>

        {error && <p className="text-destructive text-xs">{error}</p>}
        {success && <p className="text-green-600 text-xs dark:text-green-400">{success}</p>}

        <Button className="w-full gap-2" disabled={isSubmitting} onClick={handleSubmit} type="button">
          <FileCode2 className="size-4" />
          {isSubmitting
            ? isEditing
              ? '保存中…'
              : '追加中…'
            : isEditing
              ? '変更を保存'
              : '追加して配置'}
        </Button>

        <div className="space-y-2 border-border/60 border-t pt-4">
          <h3 className="font-semibold text-sm">カスタム家具の管理</h3>
          <p className="text-muted-foreground text-xs leading-relaxed">
            <code className="rounded bg-muted px-1 text-[10px]">custom</code>{' '}
            タグ付きのみ表示。編集・削除可能。組み込み CDN 家具は含みません。
          </p>
          {deletableItems.length === 0 ? (
            <p className="text-muted-foreground text-xs">カスタムエントリはありません。</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {deletableItems.map((item) => (
                <li
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5"
                  key={item.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-xs">{item.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{item.id}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      aria-label={
                        editingId === item.id ? `${item.name} の編集を終了` : `${item.name} を編集`
                      }
                      disabled={deletingId !== null || isSubmitting}
                      onClick={() => {
                        if (editingId === item.id) {
                          cancelEdit()
                        } else {
                          loadItemForEdit(item)
                        }
                      }}
                      size="sm"
                      type="button"
                      variant={editingId === item.id ? 'secondary' : 'outline'}
                    >
                      {editingId === item.id ? (
                        <X className="size-3.5" />
                      ) : (
                        <Pencil className="size-3.5" />
                      )}
                      {editingId === item.id ? '終了' : '編集'}
                    </Button>
                    <Button
                      aria-label={`${item.name} を削除`}
                      disabled={deletingId !== null}
                      onClick={() => void handleDelete(item)}
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      <Trash2 className="size-3.5" />
                      {deletingId === item.id ? '…' : '削除'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
