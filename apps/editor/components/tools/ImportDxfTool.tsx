'use client'

import {
  type CoordsJSON,
  type DxfRawEntity,
  type MergeResult,
  type SemanticJSON,
  type ValidationResult,
  mergeDxf,
  validateDxf,
} from '@pascal-app/core/importers'
import { applySceneGraphToEditor } from '@pascal-app/editor'
import { AlertCircle, CheckCircle, FileUp, UploadCloud, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DxfPreview, screenshotCanvas } from '@/components/DxfPreview'
import { DxfValidationFeedback } from '@/components/DxfValidationFeedback'
import { ImportProgress, type ImportStage } from '@/components/ImportProgress'
import {
  DEFAULT_SETTINGS,
  ImportSettings,
  type ImportSettingsValue,
  resolveUnitScale,
} from '@/components/ImportSettings'
import { useGeometryWorker } from '@/hooks/use-geometry-worker'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'preview' | 'rejected' | 'importing' | 'done' | 'error'

interface ParsedDxf {
  header: Record<string, unknown>
  entities: DxfRawEntity[]
}

interface ImportStats {
  wallCount: number
  openingCount: number
  zoneCount: number
  needsReviewCount: number
}

// ─── Scene import via MCP-compatible server route ───────────────────────────

async function importSceneViaServer(
  mergeResult: MergeResult,
  coords: CoordsJSON,
  name: string,
  guideImageUrl?: string,
): Promise<{ sceneId: string; wallCount: number; zoneCount: number; warnings: string[] }> {
  const res = await fetch('/api/dxf-import-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mergeResult, coords, guideImageUrl }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Import service returned ${res.status}`)
  }
  const data = (await res.json()) as {
    sceneId: string
    graph: Parameters<typeof applySceneGraphToEditor>[0]
    wallCount: number
    openingCount: number
    zoneCount: number
    warnings: string[]
  }
  applySceneGraphToEditor(data.graph)
  return {
    sceneId: data.sceneId,
    wallCount: data.wallCount,
    openingCount: data.openingCount,
    zoneCount: data.zoneCount,
    warnings: data.warnings,
  }
}

// ─── Job lifecycle helpers (best-effort — never throw) ───────────────────────

type PipelineMode = 'geo+ai' | 'madori'

async function createImportJob(
  dxfText: string,
  previewDataUrl: string,
  settings: ImportSettingsValue,
  pipeline: PipelineMode = 'geo+ai',
): Promise<string | null> {
  if (!dxfText) return null
  try {
    const res = await fetch('/api/dxf-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dxfText,
        previewDataUrl,
        pipeline,
        params: {
          wallThicknessMin: settings.wallThicknessMinMm / 1000,
          wallThicknessMax: settings.wallThicknessMaxMm / 1000,
        },
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { jobId?: string }
    return data.jobId ?? null
  } catch {
    return null
  }
}

// Madori pipeline: server handles analyze-dxf + parseMadori + buildGraph
async function importViaMadori(
  jobId: string,
): Promise<{ sceneId: string; wallCount: number; openingCount: number; zoneCount: number; warnings: string[] }> {
  const res = await fetch(`/api/dxf-jobs/${jobId}/madori`, { method: 'POST' })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Madori pipeline returned ${res.status}`)
  }
  return res.json() as Promise<{ sceneId: string; wallCount: number; openingCount: number; zoneCount: number; warnings: string[] }>
}

async function saveRunOutput(
  jobId: string,
  coordsJSON: CoordsJSON,
  mergedData: MergeResult,
  semanticFile: string | null,
  channelBSkipped: boolean,
): Promise<void> {
  try {
    await fetch(`/api/dxf-jobs/${jobId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordsJSON, mergedData, semanticFile, channelBSkipped }),
    })
  } catch {
    // fire-and-forget
  }
}

async function markJobImported(jobId: string): Promise<void> {
  try {
    await fetch(`/api/dxf-jobs/${jobId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'imported' }),
    })
  } catch {
    // fire-and-forget
  }
}

// ─── Channel B: vision-analyze ───────────────────────────────────────────────

async function runChannelB(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  jobId?: string,
): Promise<{ semantic: SemanticJSON | null; semanticFile: string | null }> {
  try {
    const imageDataUrl = screenshotCanvas(canvas)
    const res = await fetch('/api/vision-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl, ...(jobId ? { jobId } : {}) }),
      signal,
    })
    if (!res.ok) return { semantic: null, semanticFile: null }
    const data = (await res.json()) as SemanticJSON & { semanticFile?: string }
    return { semantic: data, semanticFile: data.semanticFile ?? null }
  } catch {
    return { semantic: null, semanticFile: null }
  }
}

// ─── Bbox computation from raw entities ──────────────────────────────────────

function entityBbox(entities: DxfRawEntity[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const e of entities) {
    if (e.type === 'LINE') {
      const l = e as unknown as { start?: { x: number; y: number }; end?: { x: number; y: number } }
      if (l.start && l.end) {
        minX = Math.min(minX, l.start.x, l.end.x)
        minY = Math.min(minY, l.start.y, l.end.y)
        maxX = Math.max(maxX, l.start.x, l.end.x)
        maxY = Math.max(maxY, l.start.y, l.end.y)
      }
    } else if (e.type === 'LWPOLYLINE') {
      const p = e as unknown as { vertices?: { x: number; y: number }[] }
      p.vertices?.forEach(v => {
        if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y
        if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y
      })
    }
  }
  return isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 1, maxY: 1 }
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface ImportDxfToolProps {
  sceneId?: string
  onClose?: () => void
  onDone?: (result: { buildingId: string; levelId: string }) => void
}

export function ImportDxfTool({ sceneId, onClose, onDone }: ImportDxfToolProps) {
  const { parse: parseGeometry } = useGeometryWorker()

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('idle')
  const [importStage, setImportStage] = useState<ImportStage | null>(null)
  const [importDone, setImportDone] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileSizeBytes, setFileSizeBytes] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [settings, setSettings] = useState<ImportSettingsValue>(DEFAULT_SETTINGS)
  const [importStats, setImportStats] = useState<ImportStats | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pipeline, setPipeline] = useState<PipelineMode>('geo+ai')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const parsedDxfRef = useRef<ParsedDxf | null>(null)
  const dxfTextRef = useRef<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const lastMergeResultRef = useRef<MergeResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  // ── Validation (shared by initial load and re-validate) ───────────────────
  const runValidation = useCallback(
    (dxf: ParsedDxf, fileSize: number, currentSettings: ImportSettingsValue) => {
      const bbox = entityBbox(dxf.entities)
      const unitScale = resolveUnitScale(currentSettings.unitScale)
      return validateDxf(
        dxf.entities,
        bbox,
        {
          fileSizeBytes: fileSize,
          unitScale,
          wallThicknessMin: currentSettings.wallThicknessMinMm / 1000,
          wallThicknessMax: currentSettings.wallThicknessMaxMm / 1000,
        },
      )
    },
    [],
  )

  // ── File processing ─────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.dxf')) {
      setErrorMsg('Please select a .dxf file.')
      setPhase('error')
      return
    }

    setFileName(file.name)
    setFileSizeBytes(file.size)

    if (file.size > 10 * 1024 * 1024) {
      const mb = (file.size / 1024 / 1024).toFixed(1)
      setValidation({
        passed: false, confidence: 0, warnings: [],
        rejectReasons: [`File size ${mb} MB exceeds the 10 MB limit`],
      })
      setPhase('rejected')
      return
    }

    let text: string
    try { text = await file.text() }
    catch { setErrorMsg('Could not read file.'); setPhase('error'); return }

    dxfTextRef.current = text

    let parsed: ParsedDxf
    try {
      const { DxfParser } = await import('dxf-parser')
      const dxf = new DxfParser().parseSync(text)
      parsed = {
        header: (dxf?.header ?? {}) as Record<string, unknown>,
        entities: (dxf?.entities ?? []) as unknown as DxfRawEntity[],
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'DXF parse failed.')
      setPhase('error')
      return
    }

    parsedDxfRef.current = parsed

    const vResult = runValidation(parsed, file.size, settings)
    setValidation(vResult)

    if (!vResult.passed) { setPhase('rejected'); return }

    setWarnings(vResult.warnings)
    setPhase('preview')
  }, [settings, runValidation])

  // ── Re-validate with new settings (used after settings change + retry) ─────
  const revalidate = useCallback(() => {
    const dxf = parsedDxfRef.current
    if (!dxf) { setPhase('idle'); return }

    const vResult = runValidation(dxf, fileSizeBytes, settings)
    setValidation(vResult)
    setWarnings(vResult.passed ? vResult.warnings : [])
    setPhase(vResult.passed ? 'preview' : 'rejected')
  }, [fileSizeBytes, settings, runValidation])

  // ── Drop / file input ───────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void processFile(file)
  }, [processFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void processFile(file)
    e.target.value = ''
  }, [processFile])

  // ── Import orchestration ────────────────────────────────────────────────────
  const handleConfirmImport = useCallback(async () => {
    const dxf = parsedDxfRef.current
    if (!dxf) return

    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    // Capture preview screenshot before phase change unmounts the canvas.
    // Reused for both job creation (audit trail) and the Guide node overlay.
    const previewDataUrl = (() => {
      try { return canvasRef.current ? screenshotCanvas(canvasRef.current) : '' }
      catch { return '' }
    })()

    setPhase('importing')
    setImportDone(false)
    setImportStats(null)
    setImportStage('parsing')

    // ── Job creation ──────────────────────────────────────────────────────────
    const jobId = await createImportJob(dxfTextRef.current ?? '', previewDataUrl, settings, pipeline)
    if (jobId) jobIdRef.current = jobId

    // ── Madori pipeline: all heavy lifting is server-side ─────────────────────
    if (pipeline === 'madori') {
      if (!jobId) {
        setErrorMsg('Could not create import job. Please try again.')
        setPhase('error')
        return
      }

      setImportStage('analyzing')
      try {
        const result = await importViaMadori(jobId)
        if (abort.signal.aborted) return
        if (result.warnings.length > 0) setWarnings(result.warnings)
        setImportStats({
          wallCount:       result.wallCount,
          openingCount:    result.openingCount,
          zoneCount:       result.zoneCount,
          needsReviewCount: 0,
        })
        setImportDone(true)
        setPhase('done')
        onDone?.({ buildingId: result.sceneId, levelId: result.sceneId })
      } catch (err) {
        if (abort.signal.aborted) return
        setErrorMsg(err instanceof Error ? err.message : 'Madori import failed.')
        setPhase('error')
      }
      return
    }

    // ── geo+ai pipeline (original flow) ──────────────────────────────────────
    let coordsJSON: CoordsJSON
    try {
      coordsJSON = await parseGeometry(
        { header: dxf.header, entities: dxf.entities },
        {
          unitScale: resolveUnitScale(settings.unitScale),
          wallThicknessMin: settings.wallThicknessMinMm / 1000,
          wallThicknessMax: settings.wallThicknessMaxMm / 1000,
        },
        abort.signal,
      )
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      setErrorMsg(err instanceof Error ? err.message : 'Geometry parse failed.')
      setPhase('error')
      return
    }

    setImportStage('analyzing')

    const timeoutCtrl = new AbortController()
    const timeout = setTimeout(() => timeoutCtrl.abort(), 10_000)
    const combined = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([abort.signal, timeoutCtrl.signal])
      : timeoutCtrl.signal

    let semanticJSON: SemanticJSON | null = null
    let semanticFile: string | null = null
    if (canvasRef.current) {
      const channelB = await runChannelB(canvasRef.current, combined, jobId ?? undefined)
      semanticJSON = channelB.semantic
      semanticFile = channelB.semanticFile
    }
    clearTimeout(timeout)
    if (abort.signal.aborted) return

    setImportStage('merging')
    await new Promise(r => setTimeout(r, 0))

    let mergeResult: MergeResult
    try {
      mergeResult = mergeDxf(coordsJSON, semanticJSON)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Data merge failed.')
      setPhase('error')
      return
    }

    // Save run output (best-effort)
    if (jobId) {
      void saveRunOutput(jobId, coordsJSON, mergeResult, semanticFile, semanticJSON === null)
    }

    lastMergeResultRef.current = mergeResult
    setImportStage('building')

    try {
      const result = await importSceneViaServer(
        mergeResult,
        coordsJSON,
        fileName || 'DXF Import',
        previewDataUrl || undefined,
      )
      if (result.warnings.length > 0) setWarnings(result.warnings)
      setImportStats({
        wallCount:       result.wallCount,
        openingCount:    result.openingCount,
        zoneCount:       result.zoneCount,
        needsReviewCount: mergeResult.walls.filter(w => w.needsReview).length,
      })

      if (jobId) void markJobImported(jobId)

      setImportDone(true)
      setPhase('done')
      onDone?.({ buildingId: result.sceneId, levelId: result.sceneId })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to write scene.')
      setPhase('error')
    }
  }, [sceneId, onDone, settings, pipeline, parseGeometry, fileName])

  const handleReset = useCallback(() => {
    abortRef.current?.abort()
    parsedDxfRef.current = null
    dxfTextRef.current = null
    jobIdRef.current = null
    lastMergeResultRef.current = null
    setPhase('idle')
    setImportStage(null)
    setImportDone(false)
    setValidation(null)
    setFileName('')
    setFileSizeBytes(0)
    setWarnings([])
    setErrorMsg('')
    setImportStats(null)
    setSettingsOpen(false)
  }, [])

  // Go back to preview with same file (re-import flow)
  const handleReImport = useCallback(() => {
    if (!parsedDxfRef.current) { setPhase('idle'); return }
    setImportStage(null)
    setImportDone(false)
    setImportStats(null)
    setWarnings([])
    setSettingsOpen(true) // open settings so user can adjust
    revalidate()
  }, [revalidate])

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-background p-6 shadow-2xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileUp className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Import DXF floor plan</h2>
        </div>
        {onClose && (
          <button
            aria-label="Close"
            className="text-muted-foreground/60 hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Idle ────────────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <>
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed py-10 transition-colors',
              isDragging
                ? 'border-blue-500 bg-blue-500/5'
                : 'border-border/60 hover:border-border hover:bg-white/3',
            )}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDrop={handleDrop}
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground/50" />
            <div className="text-center">
              <p className="font-medium text-sm">Drop a DXF file here</p>
              <p className="mt-0.5 text-muted-foreground text-xs">or click to browse (max 10 MB)</p>
            </div>
            <input accept=".dxf" className="sr-only" onChange={handleFileInput} type="file" />
          </label>
          <ImportSettings
            defaultOpen={false}
            onChange={setSettings}
            value={settings}
          />

          {/* Pipeline selector */}
          <div className="flex gap-1.5 rounded-lg border border-border/40 p-1">
            {(['geo+ai', 'madori'] as const).map(p => (
              <button
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  pipeline === p
                    ? 'bg-blue-600 text-white'
                    : 'text-muted-foreground hover:bg-muted/40',
                )}
                key={p}
                onClick={() => setPipeline(p)}
                type="button"
              >
                {p === 'geo+ai' ? 'Auto-detect (AI)' : 'Architectural CAD (Madori)'}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Preview ─────────────────────────────────────────────────── */}
      {phase === 'preview' && (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className="truncate font-medium text-foreground/80">{fileName}</span>
            <span className="shrink-0 text-muted-foreground">
              {(fileSizeBytes / 1024).toFixed(0)} KB
            </span>
          </div>

          <DxfPreview ref={canvasRef} entities={parsedDxfRef.current?.entities ?? []} />

          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              {warnings.map((w, i) => (
                <li className="flex gap-2 text-amber-400 text-xs" key={i}>
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <ImportSettings
            defaultOpen={settingsOpen}
            onChange={s => { setSettings(s); revalidate() }}
            value={settings}
          />

          {/* Pipeline selector */}
          <div className="flex gap-1.5 rounded-lg border border-border/40 p-1">
            {(['geo+ai', 'madori'] as const).map(p => (
              <button
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  pipeline === p
                    ? 'bg-blue-600 text-white'
                    : 'text-muted-foreground hover:bg-muted/40',
                )}
                key={p}
                onClick={() => setPipeline(p)}
                type="button"
              >
                {p === 'geo+ai' ? 'Auto-detect (AI)' : 'Architectural CAD (Madori)'}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              className="rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground"
              onClick={handleReset}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-sm text-white hover:bg-blue-500"
              onClick={() => void handleConfirmImport()}
              type="button"
            >
              Import
            </button>
          </div>
        </>
      )}

      {/* ── Importing ───────────────────────────────────────────────── */}
      {phase === 'importing' && (
        <>
          {/* Keep canvas mounted (opacity-0, pointer-events-none) so
              Channel B can still call screenshotCanvas(canvasRef.current) */}
          <div aria-hidden className="pointer-events-none absolute opacity-0">
            <DxfPreview ref={canvasRef} entities={parsedDxfRef.current?.entities ?? []} />
          </div>
          <ImportProgress done={importDone} stage={importStage} />
        </>
      )}

      {/* ── Rejected ────────────────────────────────────────────────── */}
      {phase === 'rejected' && validation && (
        <DxfValidationFeedback
          onAdjustSettings={() => {
            setSettingsOpen(true)
            // If we already have parsed data, drop back to preview with settings open
            if (parsedDxfRef.current && validation.passed === false) {
              // try with current settings — user will adjust in preview
              revalidate()
            } else {
              setPhase('idle')
            }
          }}
          onRetry={handleReset}
          validation={validation}
        />
      )}

      {/* ── Done ────────────────────────────────────────────────────── */}
      {phase === 'done' && (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/5 p-4 text-green-400">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span className="font-medium text-sm">Import complete</span>
          </div>

          {/* Import stats */}
          {importStats && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <StatChip label="walls" value={importStats.wallCount} />
              <StatChip label="openings" value={importStats.openingCount} />
              <StatChip label="rooms" value={importStats.zoneCount} />
            </div>
          )}

          {/* Needs-review notice */}
          {importStats && importStats.needsReviewCount > 0 && (
            <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-400 text-xs">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {importStats.needsReviewCount} node{importStats.needsReviewCount !== 1 ? 's' : ''} flagged for review (yellow badge)
            </p>
          )}

          {/* Warnings summary */}
          {warnings.length > 0 && (
            <p className="text-muted-foreground text-xs">
              {warnings.length} notice{warnings.length !== 1 ? 's' : ''} — see flagged nodes in the scene
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              className="rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground"
              onClick={handleReImport}
              type="button"
            >
              Re-import with different settings
            </button>
            <button
              className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm hover:bg-accent/40"
              onClick={onClose ?? handleReset}
              type="button"
            >
              Close
            </button>
          </div>
        </>
      )}

      {/* ── Error ───────────────────────────────────────────────────── */}
      {phase === 'error' && (
        <>
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
            {errorMsg || 'An unknown error occurred.'}
          </div>
          <button
            className="self-end rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground"
            onClick={handleReset}
            type="button"
          >
            Try again
          </button>
        </>
      )}
    </div>
  )
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-border/40 bg-muted/20 py-2">
      <span className="font-semibold text-foreground text-lg tabular-nums">{value}</span>
      <span className="text-muted-foreground/70 text-[10px]">{label}</span>
    </div>
  )
}
