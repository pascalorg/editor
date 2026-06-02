'use client'

import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

// ─── Settings type ────────────────────────────────────────────────────────────

export type UnitScaleOption = 'auto' | 'mm' | 'cm' | 'm'

export interface ImportSettingsValue {
  /** Minimum wall thickness, in millimetres (UI unit). Converted to metres before use. */
  wallThicknessMinMm: number
  /** Maximum wall thickness, in millimetres (UI unit). Converted to metres before use. */
  wallThicknessMaxMm: number
  /** Unit scale option. 'auto' lets the parser infer from the DXF header / bbox. */
  unitScale: UnitScaleOption
}

export const DEFAULT_SETTINGS: ImportSettingsValue = {
  wallThicknessMinMm: 80,
  wallThicknessMaxMm: 400,
  unitScale: 'auto',
}

/** Convert settings to the numeric scale factor consumed by the parsers. */
export function resolveUnitScale(opt: UnitScaleOption): number | undefined {
  if (opt === 'mm') return 0.001
  if (opt === 'cm') return 0.01
  if (opt === 'm') return 1.0
  return undefined // 'auto' → let inferScale decide
}

/** True when any value differs from the defaults. */
export function isModified(s: ImportSettingsValue): boolean {
  return (
    s.wallThicknessMinMm !== DEFAULT_SETTINGS.wallThicknessMinMm ||
    s.wallThicknessMaxMm !== DEFAULT_SETTINGS.wallThicknessMaxMm ||
    s.unitScale !== DEFAULT_SETTINGS.unitScale
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

const UNIT_OPTIONS: { value: UnitScaleOption; label: string; detail: string }[] = [
  { value: 'auto', label: '自动检测', detail: '从文件头或图纸尺寸推断' },
  { value: 'mm',   label: '毫米 (mm)', detail: '1 单位 = 1 mm' },
  { value: 'cm',   label: '厘米 (cm)', detail: '1 单位 = 1 cm' },
  { value: 'm',    label: '米 (m)',    detail: '1 单位 = 1 m' },
]

export interface ImportSettingsProps {
  value: ImportSettingsValue
  onChange: (next: ImportSettingsValue) => void
  /** If true, the panel starts expanded */
  defaultOpen?: boolean
  className?: string
}

export function ImportSettings({ value, onChange, defaultOpen = false, className }: ImportSettingsProps) {
  const [open, setOpen] = useState(defaultOpen)
  const modified = isModified(value)

  function set<K extends keyof ImportSettingsValue>(key: K, val: ImportSettingsValue[K]) {
    onChange({ ...value, [key]: val })
  }

  function reset() {
    onChange({ ...DEFAULT_SETTINGS })
  }

  // Clamp helper so min < max is always maintained
  function setMin(v: number) {
    const clamped = Math.max(10, Math.min(v, value.wallThicknessMaxMm - 10))
    set('wallThicknessMinMm', clamped)
  }

  function setMax(v: number) {
    const clamped = Math.min(800, Math.max(v, value.wallThicknessMinMm + 10))
    set('wallThicknessMaxMm', clamped)
  }

  return (
    <div className={cn('rounded-lg border border-border/40 text-sm', className)}>
      {/* Header / toggle */}
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span className="flex items-center gap-2 font-medium text-muted-foreground text-xs">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          高级设置
        </span>
        {modified && (
          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-medium text-blue-400 text-[10px]">
            已修改
          </span>
        )}
      </button>

      {/* Body */}
      {open && (
        <div className="flex flex-col gap-4 border-t border-border/40 px-3 pb-3 pt-3">
          {/* Wall thickness range */}
          <fieldset>
            <legend className="mb-2 font-medium text-muted-foreground text-xs">
              墙体厚度范围（mm）
            </legend>
            <div className="flex items-center gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-muted-foreground/70 text-[10px]">最小</span>
                <input
                  className="w-full rounded-md border border-border/60 bg-background px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  max={value.wallThicknessMaxMm - 10}
                  min={10}
                  onChange={e => setMin(Number(e.target.value))}
                  step={5}
                  type="number"
                  value={value.wallThicknessMinMm}
                />
              </label>
              <span className="mt-4 text-muted-foreground/50 text-xs">—</span>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-muted-foreground/70 text-[10px]">最大</span>
                <input
                  className="w-full rounded-md border border-border/60 bg-background px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  max={800}
                  min={value.wallThicknessMinMm + 10}
                  onChange={e => setMax(Number(e.target.value))}
                  step={5}
                  type="number"
                  value={value.wallThicknessMaxMm}
                />
              </label>
            </div>
            <p className="mt-1.5 text-muted-foreground/50 text-[10px]">
              典型值：外墙 200–400 mm，内墙 80–200 mm
            </p>
          </fieldset>

          {/* Unit scale */}
          <div>
            <label className="mb-2 block font-medium text-muted-foreground text-xs">
              图纸单位
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {UNIT_OPTIONS.map(opt => (
                <button
                  className={cn(
                    'flex flex-col items-start rounded-md border px-2.5 py-2 text-left transition-colors',
                    value.unitScale === opt.value
                      ? 'border-blue-500/40 bg-blue-500/10 text-foreground'
                      : 'border-border/40 text-muted-foreground hover:border-border hover:bg-muted/30',
                  )}
                  key={opt.value}
                  onClick={() => set('unitScale', opt.value)}
                  type="button"
                >
                  <span className="font-medium text-xs">{opt.label}</span>
                  <span className="text-muted-foreground/60 text-[10px]">{opt.detail}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Reset */}
          {modified && (
            <button
              className="flex items-center gap-1.5 self-end text-muted-foreground/60 text-xs hover:text-muted-foreground"
              onClick={reset}
              type="button"
            >
              <RotateCcw className="h-3 w-3" />
              恢复默认值
            </button>
          )}
        </div>
      )}
    </div>
  )
}
