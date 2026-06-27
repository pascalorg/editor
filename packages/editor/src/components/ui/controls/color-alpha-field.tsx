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
            className="h-1.5 min-w-0 flex-1 accent-violet-400"
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
