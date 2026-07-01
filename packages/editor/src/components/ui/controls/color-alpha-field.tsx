'use client'

type ColorAlphaFieldProps = {
  label: string
  value: string
  onColorChange: (value: string) => void
  opacity?: number
  onOpacityChange?: (value: number) => void
  opacityMin?: number
  opacityMax?: number
  opacityStep?: number
}

export const THIN_RANGE_INPUT_CLASS =
  'h-3 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent accent-violet-400 [&::-moz-range-progress]:h-0.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-violet-400 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-violet-400 [&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/20 [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/20 [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888'
}

export function ColorAlphaField({
  label,
  value,
  onColorChange,
  opacity,
  onOpacityChange,
  opacityMin = 0,
  opacityMax = 1,
  opacityStep = 0.05,
}: ColorAlphaFieldProps) {
  const color = normalizeHexColor(value)
  const supportsOpacity = typeof opacity === 'number' && !!onOpacityChange
  const boundedOpacity = supportsOpacity ? clamp(opacity, opacityMin, opacityMax) : 1
  const opacityPercent = Math.round(boundedOpacity * 100)

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-foreground/80 text-xs">{label}</span>
        <div className="flex items-center gap-2">
          <input
            className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent"
            onChange={(event) => onColorChange(event.target.value)}
            type="color"
            value={color}
          />
          <input
            className="w-20 rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
            onChange={(event) => onColorChange(event.target.value)}
            type="text"
            value={value}
          />
        </div>
      </div>
      {supportsOpacity ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="w-12 shrink-0 text-muted-foreground text-[11px]">{'\u900f\u660e\u5ea6'}</span>
          <input
            className={THIN_RANGE_INPUT_CLASS}
            max={opacityMax}
            min={opacityMin}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) onOpacityChange(clamp(next, opacityMin, opacityMax))
            }}
            step={opacityStep}
            type="range"
            value={boundedOpacity}
          />
          <input
            className="w-12 rounded-md border border-border/50 bg-[#2C2C2E] px-1.5 py-1 text-right text-foreground text-[11px] focus:outline-none focus:ring-1 focus:ring-foreground/30"
            max={100}
            min={Math.round(opacityMin * 100)}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) onOpacityChange(clamp(next / 100, opacityMin, opacityMax))
            }}
            step={Math.max(1, Math.round(opacityStep * 100))}
            type="number"
            value={opacityPercent}
          />
          <span className="text-muted-foreground text-[11px]">%</span>
        </div>
      ) : null}
    </div>
  )
}
