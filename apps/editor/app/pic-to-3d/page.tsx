'use client'

import { ImagePlus, Loader2, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DetailPresetPicker, type DetailPreset } from './detail-preset-picker'
import { GlbPreviewPanel } from './glb-preview'
import type { PicTo3DParams } from './param-panel'

const PRESET_STORAGE_KEY = 'pic-to-3d-preset-v1'

type JobState = 'idle' | 'uploading' | 'processing' | 'complete' | 'error'

type GlbRef = {
  filename: string
  subfolder: string
  type: string
}

export default function PicTo3DPage() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [jobState, setJobState] = useState<JobState>('idle')
  const [promptId, setPromptId] = useState<string | null>(null)
  const [glb, setGlb] = useState<GlbRef | null>(null)
  const [glbPreviewVersion, setGlbPreviewVersion] = useState(0)
  const [downloadName, setDownloadName] = useState('model.glb')
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const [params, setParams] = useState<PicTo3DParams | null>(null)
  const [presets, setPresets] = useState<DetailPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('default')

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/pic-to-3d/defaults')
        const body = (await response.json()) as {
          defaults: PicTo3DParams
          presets: DetailPreset[]
        }
        if (!response.ok) return

        setPresets(body.presets)

        const storedId = localStorage.getItem(PRESET_STORAGE_KEY)
        const match =
          storedId && body.presets.some((p) => p.id === storedId)
            ? body.presets.find((p) => p.id === storedId)!
            : body.presets.find((p) => p.id === 'default') ?? body.presets[0]

        if (match) {
          setSelectedPresetId(match.id)
          setParams({ ...match.params })
        } else {
          setParams({ ...body.defaults })
        }
      } catch {
        /* ignore */
      }
    })()
  }, [])

  const selectPreset = useCallback((preset: DetailPreset) => {
    setSelectedPresetId(preset.id)
    setParams({ ...preset.params })
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, preset.id)
    } catch {
      /* quota */
    }
  }, [])

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearPoll()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [clearPoll, previewUrl])

  useEffect(() => {
    const preventDefaults = (event: DragEvent) => {
      event.preventDefault()
    }
    window.addEventListener('dragover', preventDefaults)
    window.addEventListener('drop', preventDefaults)
    return () => {
      window.removeEventListener('dragover', preventDefaults)
      window.removeEventListener('drop', preventDefaults)
    }
  }, [])

  const applyImageFile = useCallback(
    (next: File | null) => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setFile(next)
      setPreviewUrl(next ? URL.createObjectURL(next) : null)
      setJobState('idle')
      setPromptId(null)
      setGlb(null)
      setGlbPreviewVersion(0)
      setError(null)
      setStatusText('')
      clearPoll()
    },
    [clearPoll, previewUrl],
  )

  const acceptDroppedFile = (candidate: File | undefined) => {
    if (!candidate) return
    if (!candidate.type.startsWith('image/')) {
      setError('Use an image file such as JPG, PNG, or WebP.')
      return
    }
    applyImageFile(candidate)
  }

  const pollStatus = useCallback(
    (id: string) => {
      clearPoll()
      pollRef.current = setInterval(async () => {
        try {
          const response = await fetch(`/api/pic-to-3d/status?promptId=${encodeURIComponent(id)}`)
          const body = (await response.json()) as {
            state?: string
            error?: string
            glb?: GlbRef
            downloadName?: string
          }

          if (!response.ok) {
            throw new Error(body.error ?? 'Failed to fetch status.')
          }

          if (body.state === 'pending') {
            setStatusText('ComfyUI is generating the 3D model (Hunyuan 3D 2.1)...')
            return
          }

          clearPoll()

          if (body.state === 'error') {
            setJobState('error')
            setError(body.error ?? 'Generation failed.')
            return
          }

          if (body.state === 'complete' && body.glb) {
            setGlb(body.glb)
            setGlbPreviewVersion((v) => v + 1)
            setDownloadName(body.downloadName ?? 'model.glb')
            setJobState('complete')
            setStatusText('Generation complete. Preview the model on the right.')
          }
        } catch (pollError) {
          clearPoll()
          setJobState('error')
          setError(pollError instanceof Error ? pollError.message : 'Polling failed.')
        }
      }, 2000)
    },
    [clearPoll],
  )

  const handleGenerate = async () => {
    if (!file) {
      setError('Select an image first.')
      return
    }
    if (!params) {
      setError('Parameters are still loading. Please wait.')
      return
    }

    setError(null)
    setGlb(null)
    setGlbPreviewVersion(0)
    setPromptId(null)
    setJobState('uploading')
    setStatusText('Uploading image to ComfyUI...')

    const form = new FormData()
    form.append('image', file)
    form.append('params', JSON.stringify(params))

    try {
      const response = await fetch('/api/pic-to-3d/generate', { method: 'POST', body: form })
      const body = (await response.json()) as {
        ok?: boolean
        promptId?: string
        error?: string
        message?: string
      }

      if (!response.ok || !body.promptId) {
        throw new Error(body.error ?? 'Submit failed.')
      }

      setPromptId(body.promptId)
      setJobState('processing')
      setStatusText(body.message ?? 'Queued. Waiting for generation...')
      pollStatus(body.promptId)
    } catch (generateError) {
      setJobState('error')
      setError(generateError instanceof Error ? generateError.message : 'Submit failed.')
    }
  }

  const downloadUrl = useMemo(() => {
    if (!glb) return null
    return `/api/pic-to-3d/download?${new URLSearchParams({
      filename: glb.filename,
      subfolder: glb.subfolder,
      type: glb.type,
      downloadName,
    }).toString()}`
  }, [glb, downloadName])

  const glbPreviewUrl = useMemo(() => {
    if (!glb || glbPreviewVersion === 0) return null
    const params = new URLSearchParams({
      filename: glb.filename,
      subfolder: glb.subfolder,
      type: glb.type,
      downloadName,
      v: String(glbPreviewVersion),
    })
    return `/api/pic-to-3d/download?${params.toString()}`
  }, [glb, downloadName, glbPreviewVersion])

  const busy = jobState === 'uploading' || jobState === 'processing'

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/"
            >
              Editor
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">Image to 3D</span>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 space-y-2">
          <h1 className="flex items-center gap-2 font-bold text-2xl">
            <Sparkles className="size-6 text-primary" />
            Image to 3D
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Generate a GLB from a photo. Choose a detail level, run generation, and preview the
            model on the right. ComfyUI: Hunyuan 3D 2.1.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-start">
          <div className="space-y-6 rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-muted/20 hover:bg-muted/40'
              }`}
              htmlFor="pic-input"
              onDragEnter={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!busy) setDragOver(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                setDragOver(false)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragOver(false)
                if (busy) return
                acceptDroppedFile(e.dataTransfer.files?.[0])
              }}
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Preview"
                  className="max-h-48 max-w-full rounded-lg object-contain"
                  src={previewUrl}
                />
              ) : (
                <>
                  <ImagePlus className="size-10 text-muted-foreground" />
                  <span className="text-muted-foreground text-sm">
                    Click or drag an image to upload (JPG / PNG)
                  </span>
                </>
              )}
              <input
                accept="image/*"
                className="sr-only"
                disabled={busy}
                id="pic-input"
                onChange={(e) => applyImageFile(e.target.files?.[0] ?? null)}
                type="file"
              />
            </label>

            {file && (
              <p className="text-center text-muted-foreground text-xs">
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}

            {presets.length > 0 && (
              <DetailPresetPicker
                disabled={busy}
                onSelect={selectPreset}
                presets={presets}
                selectedId={selectedPresetId}
              />
            )}

            <button
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!file || busy || !params}
              onClick={() => void handleGenerate()}
              type="button"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {jobState === 'uploading' ? 'Uploading...' : 'Generating...'}
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Generate 3D Model
                </>
              )}
            </button>

            {statusText && jobState !== 'error' && (
              <p className="text-center text-muted-foreground text-xs">{statusText}</p>
            )}
            {promptId && jobState === 'processing' && (
              <p className="text-center font-mono text-[10px] text-muted-foreground">
                Task: {promptId}
              </p>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                {error}
              </p>
            )}
          </div>

          <div className="lg:sticky lg:top-20">
            <GlbPreviewPanel
              downloadName={downloadName}
              downloadUrl={downloadUrl}
              glbUrl={glbPreviewUrl}
              status={jobState}
              statusText={jobState === 'error' ? error ?? undefined : statusText}
            />
          </div>
        </div>

        <p className="mt-6 text-muted-foreground text-xs leading-relaxed">
          The selected detail preset is saved in the browser. Ultra Detail takes longer and creates
          larger files, but is better for final output. Quick is intended for drafts and checks.
        </p>
      </main>
    </div>
  )
}
