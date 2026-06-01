'use client'

import type { AssetInput } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { Box, ImagePlus, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '@/i18n'

const CATEGORIES = ['equipment', 'lighting', 'electronics', 'outdoor', 'vehicle', 'nature']
const PROVIDERS = [
  { id: 'hunyuan3d', label: 'Hunyuan3D' },
  { id: 'fal', label: 'fal SAM 3D' },
]

function isAsset(value: unknown): value is AssetInput {
  return typeof value === 'object' && value !== null && 'src' in value && 'thumbnail' in value
}

export function ImageTo3DLeadingTile() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('equipment')
  const [provider, setProvider] = useState('hunyuan3d')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setPreviewUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  const handleGenerate = async () => {
    if (!file) {
      setError(t('imageTo3d.pickImageFirst', 'Please choose an image first.'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('image', file)
      form.set('prompt', prompt)
      form.set('name', name)
      form.set('category', category)
      form.set('provider', provider)
      form.set('save', 'true')
      const res = await fetch('/api/image-to-3d/generate', {
        method: 'POST',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : t('imageTo3d.generateFailed', 'Generation failed.'),
        )
      }
      if (!isAsset(data.asset)) {
        throw new Error(
          t('imageTo3d.invalidAsset', 'Generation finished but returned an invalid asset.'),
        )
      }

      const editor = useEditor.getState()
      editor.enterFurnishBuildMode({ openItemsPanel: true })
      editor.setCatalogCategory(
        (data.asset.category as Parameters<typeof editor.setCatalogCategory>[0]) ?? 'equipment',
      )
      editor.setSelectedItem(data.asset)
      window.dispatchEvent(new Event('generated-assets:updated'))
      setOpen(false)
      setFile(null)
      setPrompt('')
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        className="flex min-h-[118px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-violet-400/50 bg-violet-500/10 p-2 text-center text-violet-100 transition-colors hover:border-violet-300 hover:bg-violet-500/20"
        onClick={() => setOpen(true)}
        type="button"
      >
        <div className="flex size-9 items-center justify-center rounded-full bg-violet-500/25">
          <ImagePlus className="h-5 w-5" />
        </div>
        <span className="font-medium text-[11px]">{t('imageTo3d.tileTitle', 'Image to 3D')}</span>
        <span className="text-[9px] text-violet-200/70">
          {t('imageTo3d.tileSubtitle', 'Hunyuan3D / fal')}
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-4 text-foreground shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-sm">
                  {t('imageTo3d.dialogTitle', 'Generate 3D from image')}
                </h2>
                <p className="mt-1 text-muted-foreground text-xs">
                  {t(
                    'imageTo3d.dialogSubtitle',
                    'Upload one product/object image and save it into Mine.',
                  )}
                </p>
              </div>
              <button
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                disabled={loading}
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <button
                className="flex h-36 w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/50"
                disabled={loading}
                onClick={() => inputRef.current?.click()}
                type="button"
              >
                {previewUrl ? (
                  <img alt="" className="h-full w-full object-contain" src={previewUrl} />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs">
                    <Box className="h-6 w-6" />
                    {t('imageTo3d.pickImage', 'Choose PNG, JPG, or WebP')}
                  </div>
                )}
              </button>
              <input
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={loading}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                ref={inputRef}
                type="file"
              />

              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-400"
                disabled={loading}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('imageTo3d.namePlaceholder', 'Asset name')}
                value={name}
              />
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-400"
                disabled={loading}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t(
                  'imageTo3d.promptPlaceholder',
                  'Prompt, e.g. chair, lamp, appliance',
                )}
                value={prompt}
              />
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-400"
                disabled={loading}
                onChange={(event) => setProvider(event.target.value)}
                value={provider}
              >
                {PROVIDERS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-400"
                disabled={loading}
                onChange={(event) => setCategory(event.target.value)}
                value={category}
              >
                {CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              {error ? (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-red-200 text-xs">
                  {error}
                </div>
              ) : null}

              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 font-medium text-sm text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                onClick={handleGenerate}
                type="button"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
                {loading
                  ? t('imageTo3d.generating', 'Generating...')
                  : t('imageTo3d.generate', 'Generate and save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
