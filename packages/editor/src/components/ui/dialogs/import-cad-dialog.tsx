'use client'

import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, Ruler, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { type CadImportAnalysis, formatExtent } from '../../../lib/cad-import'
import { cn } from '../../../lib/utils'
import { Button } from '../primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../primitives/dialog'

export type ImportCadResult = {
  metersPerUnit: number
  hiddenLayers: string[]
}

type Props = {
  analysis: CadImportAnalysis | null
  error: string | null
  busy: boolean
  onCancel: () => void
  onConfirm: (result: ImportCadResult) => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ImportCadDialog({ analysis, error, busy, onCancel, onConfirm }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [metersPerUnit, setMetersPerUnit] = useState<number | null>(null)

  // Seed the choices from the drawing whenever a new file is analysed: layers
  // it turned off start off, and the declared unit is taken as given.
  useEffect(() => {
    if (!analysis) return
    setHidden(new Set(analysis.layers.filter((l) => !l.visibleByDefault).map((l) => l.name)))
    setMetersPerUnit(
      analysis.metersPerUnit ??
        analysis.unitSuggestions.find((s) => s.likely)?.metersPerUnit ??
        null,
    )
  }, [analysis])

  const visibleSegments = useMemo(() => {
    if (!analysis) return 0
    return analysis.layers
      .filter((layer) => !hidden.has(layer.name))
      .reduce((sum, layer) => sum + layer.segmentCount, 0)
  }, [analysis, hidden])

  if (!analysis && !error) return null

  const canImport =
    !!analysis && !busy && metersPerUnit !== null && analysis.segmentCount > 0 && visibleSegments > 0

  const toggleLayer = (name: string) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
      open
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {error ? (
              <XCircle className="size-5 text-red-600" />
            ) : (
              <CheckCircle2 className="size-5 text-emerald-600" />
            )}
            {error ? 'Cannot import this drawing' : 'Import CAD drawing'}
          </DialogTitle>
          {analysis && (
            <DialogDescription>
              {analysis.fileName} · {formatFileSize(analysis.fileSizeBytes)} ·{' '}
              {analysis.segmentCount.toLocaleString()} lines
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-xs">
              {error}
            </div>
          )}

          {analysis?.warnings.map((warning) => (
            <div
              className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800 text-xs"
              key={warning.code}
            >
              <AlertTriangle className="mt-px size-4 shrink-0" />
              <span>{warning.message}</span>
            </div>
          ))}

          {analysis && analysis.unitSuggestions.length > 0 && (
            <div className="rounded-md border bg-card">
              <div className="flex items-center gap-2 border-b px-3 py-2 font-medium text-muted-foreground text-xs uppercase">
                <Ruler className="size-3.5" />
                Drawing units
              </div>
              <p className="border-b px-3 py-2 text-muted-foreground text-xs leading-snug">
                {analysis.metersPerUnit === null
                  ? 'This drawing declares no units. Pick the one that gives a sensible size.'
                  : 'Files often declare the wrong unit — a plan drawn in centimetres and saved as millimetres imports ten times too big. Check the size below before importing.'}
              </p>
              <div className="p-2">
                <div className="grid grid-cols-1 gap-1">
                  {analysis.unitSuggestions.map((suggestion) => (
                    <button
                      className={cn(
                        'flex items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors',
                        metersPerUnit === suggestion.metersPerUnit
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/40',
                      )}
                      key={suggestion.label}
                      onClick={() => setMetersPerUnit(suggestion.metersPerUnit)}
                      type="button"
                    >
                      <span className="flex items-center gap-2">
                        {suggestion.label}
                        {suggestion.declared && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
                            in file
                          </span>
                        )}
                        {suggestion.likely && !suggestion.declared && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-[10px] text-emerald-700">
                            likely
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatExtent(suggestion.widthMeters)} ×{' '}
                        {formatExtent(suggestion.heightMeters)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {analysis && analysis.layers.length > 0 && (
            <div className="rounded-md border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="font-medium text-muted-foreground text-xs uppercase">
                  Layers ({analysis.layers.length})
                </span>
                <span className="text-muted-foreground text-xs">
                  {visibleSegments.toLocaleString()} of{' '}
                  {analysis.segmentCount.toLocaleString()} lines shown
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {analysis.layers.map((layer) => {
                  const isHidden = hidden.has(layer.name)
                  const share = analysis.segmentCount
                    ? (layer.segmentCount / analysis.segmentCount) * 100
                    : 0
                  return (
                    <button
                      className="flex w-full items-center gap-2 border-b px-3 py-1.5 text-left last:border-b-0 hover:bg-accent/30"
                      key={layer.name}
                      onClick={() => toggleLayer(layer.name)}
                      type="button"
                    >
                      {isHidden ? (
                        <EyeOff className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Eye className="size-3.5 shrink-0" />
                      )}
                      <span
                        className={cn(
                          'flex-1 truncate text-sm',
                          isHidden && 'text-muted-foreground line-through',
                        )}
                      >
                        {layer.name}
                      </span>
                      {/* Weight bar: on a real drawing a handful of decoration
                          layers carry most of the geometry, and seeing which
                          ones is what makes turning them off an obvious move. */}
                      <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            isHidden ? 'bg-muted-foreground/30' : 'bg-primary/60',
                          )}
                          style={{ width: `${Math.max(2, share)}%` }}
                        />
                      </span>
                      <span className="w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                        {layer.segmentCount.toLocaleString()}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button disabled={busy} onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!canImport}
            onClick={() =>
              metersPerUnit !== null && onConfirm({ metersPerUnit, hiddenLayers: [...hidden] })
            }
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
