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
    (joined.includes('BBox 对角线') && joined.includes('疑似机械零件图'))

  const isUnitsMismatch =
    joined.includes('BBox 对角线') && !joined.includes('疑似场地图')

  const isNoWalls =
    joined.includes('平行线对') || joined.includes('封闭多边形')

  const isTooFewLines = joined.includes('LINE + LWPOLYLINE 实体仅')
  const isFileTooLarge = joined.includes('超过最大限制 10MB')
  const isSiteMap =
    joined.includes('疑似场地图') || joined.includes('坐标系错误')

  if (isFileTooLarge) {
    suggestions.push('请在 DXF 应用中合并图层并导出较小的平面图区域后重试')
  }

  if (isMechanical) {
    suggestions.push('请确认上传的是建筑平面图（户型图），而非机械或工业图纸')
  }

  if (isUnitsMismatch) {
    suggestions.push(
      '如果这是正确的户型图，图纸单位可能被错误识别。请在「高级设置」中手动指定单位（mm / m）后重试',
    )
  }

  if (isSiteMap) {
    suggestions.push(
      '图纸范围超过 500 m，疑似场地总图。请导出单独的楼层平面图后重试',
    )
  }

  if (isNoWalls) {
    suggestions.push(
      '未检测到墙体。请检查图层命名（推荐使用 WALL 或 墙）或在「高级设置」中扩大墙体厚度范围',
    )
  }

  if (isTooFewLines) {
    suggestions.push('文件中线条元素过少，请确认导出的 DXF 包含完整的建筑平面信息')
  }

  if (suggestions.length === 0) {
    suggestions.push('请确认上传的是建筑平面图（户型图）')
  }

  return suggestions
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface DxfValidationFeedbackProps {
  validation: ValidationResult
  /** Called when user clicks "重新选择文件" */
  onRetry: () => void
  /** If provided, shows an "调整设置后重试" secondary action */
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
          无法导入此文件
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
          建议操作
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
            调整设置
          </button>
        )}
        <button
          className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm hover:bg-accent/40"
          onClick={onRetry}
          type="button"
        >
          <FileSearch className="h-3.5 w-3.5" />
          重新选择文件
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
  const parts = reason.split(/(\d+(?:\.\d+)?(?:m|MB|mm|%|个)?)/g)
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
