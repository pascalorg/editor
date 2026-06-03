'use client'

import type { PicTo3DParams } from './param-panel'

export type DetailPreset = {
  id: string
  label: string
  description: string
  params: PicTo3DParams
}

/** 精細度プリセット（速い → 高精細） */
export const DETAIL_PRESET_ORDER = ['fast', 'default', 'balanced', 'detail', 'ultra'] as const

const SHORT_LABELS: Record<string, string> = {
  fast: 'クイック',
  default: '標準',
  balanced: 'バランス',
  detail: '高精細',
  ultra: '最高精細',
}

export function DetailPresetPicker({
  presets,
  selectedId,
  disabled,
  onSelect,
}: {
  presets: DetailPreset[]
  selectedId: string
  disabled?: boolean
  onSelect: (preset: DetailPreset) => void
}) {
  const ordered = DETAIL_PRESET_ORDER.map((id) => presets.find((p) => p.id === id)).filter(
    (p): p is DetailPreset => Boolean(p),
  )

  const active = presets.find((p) => p.id === selectedId)

  return (
    <div className="space-y-2">
      <p className="font-medium text-xs">精細度</p>
      <div className="flex flex-wrap gap-2">
        {ordered.map((preset) => {
          const activeBtn = preset.id === selectedId
          return (
            <button
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${
                activeBtn
                  ? 'border-primary bg-primary/10 font-medium text-foreground ring-1 ring-primary/30'
                  : 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              disabled={disabled}
              key={preset.id}
              onClick={() => onSelect(preset)}
              title={preset.description}
              type="button"
            >
              {SHORT_LABELS[preset.id] ?? preset.label}
            </button>
          )
        })}
      </div>
      {active && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">{active.description}</p>
      )}
    </div>
  )
}
