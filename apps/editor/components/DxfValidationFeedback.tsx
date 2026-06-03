'use client'

import type { ValidationResult } from '@pascal-app/core/importers'
import { AlertCircle, AlertTriangle, FileSearch, Info, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Suggestion engine ────────────────────────────────────────────────────────

/**
 * Derive human-readable suggestions from the rejection reasons.
 * Each reason string contains specific measured values (from the validator),
 * so we key on substrings that identify the failure category.
 * Exported for unit testing.
 */
export function getRejectSuggestions(reasons: string[]): string[] {
  const joined = reasons.join('\n')
  const suggestions: string[] = []

  const isMechanical =
    joined.includes('CIRCLE + SPLINE') ||
    joined.includes('mechanical drawing')

  const isUnitsMismatch =
    joined.includes('BBox diagonal') && !joined.includes('site plan')

  const isNoWalls =
    joined.includes('parallel line pairs') || joined.includes('closed polygon')

  const isTooFewLines = joined.includes('LINE + LWPOLYLINE produced only')
  const isFileTooLarge = joined.includes('exceeds the 10 MB limit')
  const isSiteMap =
    joined.includes('site plan') || joined.includes('coordinate error')

  if (isFileTooLarge) {
    suggestions.push('Merge layers in your DXF application and export a smaller floor plan area, then retry.')
  }

  if (isMechanical) {
    suggestions.push('Make sure you are uploading an architectural floor plan, not a mechanical or industrial drawing.')
  }

  if (isUnitsMismatch) {
    suggestions.push(
      'If this is a valid floor plan, the drawing units may have been misdetected. Try setting units manually (mm / m) in Advanced settings.',
    )
  }

  if (isSiteMap) {
    suggestions.push('Drawing extent exceeds 500 m — this looks like a site plan. Export a single floor plan and retry.')
  }

  if (isNoWalls) {
    suggestions.push(
      'No walls detected. Check layer names (recommended: WALL) or increase the wall thickness range in Advanced settings.',
    )
  }

  if (isTooFewLines) {
    suggestions.push('Too few line elements found. Make sure the exported DXF contains the full floor plan geometry.')
  }

  if (suggestions.length === 0) {
    suggestions.push('Make sure you are uploading an architectural floor plan.')
  }

  return suggestions
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface DxfValidationFeedbackProps {
  validation: ValidationResult
  /** Called when user clicks "Choose another file" */
  onRetry: () => void
  /** If provided, shows an "Adjust settings" secondary action */
  onAdjustSettings?: () => void
  className?: string
}

export function DxfValidationFeedback({
  validation,
  onRetry,
  onAdjustSettings,
  className,
}: DxfValidationFeedbackProps) {
  const suggestions = getRejectSuggestions(validation.rejectReasons)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* ── Rejection header ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Cannot import this file
        </div>

        {/* Reasons */}
        <ul className="space-y-2">
          {validation.rejectReasons.map((reason, i) => (
            <ReasonItem key={i} reason={reason} />
          ))}
        </ul>
      </div>

      {/* ── Suggestions ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
          <Info className="h-3.5 w-3.5" />
          Suggestions
        </div>
        <ul className="space-y-1">
          {suggestions.map((s, i) => (
            <li className="text-muted-foreground text-xs" key={i}>
              • {s}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Soft warnings (if any) ────────────────────────────────────── */}
      {validation.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          {validation.warnings.map((w, i) => (
            <li className="flex gap-2 text-amber-400 text-xs" key={i}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2">
        {onAdjustSettings && (
          <button
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground"
            onClick={onAdjustSettings}
            type="button"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Adjust settings
          </button>
        )}
        <button
          className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm hover:bg-accent/40"
          onClick={onRetry}
          type="button"
        >
          <FileSearch className="h-3.5 w-3.5" />
          Choose another file
        </button>
      </div>
    </div>
  )
}

// ─── Single reason item with value emphasis ───────────────────────────────────

/**
 * Displays a reject reason, bolding numeric values like "0.048m" or "71%"
 * so users immediately see the measured data.
 */
function ReasonItem({ reason }: { reason: string }) {
  // Split on numbers + unit patterns and wrap them with emphasis
  const parts = reason.split(/(\d+(?:\.\d+)?(?:\s?MB|mm|m|%)?)(?=\s|$|,|—|–)/g)
  return (
    <li className="flex gap-2 text-muted-foreground text-xs">
      <span className="mt-0.5 text-destructive/70">•</span>
      <span>
        {parts.map((part, i) =>
          /^\d/.test(part) ? (
            <strong className="font-semibold text-foreground" key={i}>
              {part}
            </strong>
          ) : (
            part
          ),
        )}
      </span>
    </li>
  )
}
