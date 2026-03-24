import { Html } from '@react-three/drei'
import { useEffect, useRef } from 'react'

interface DrawingDimensionLabelProps {
  position: [number, number, number]
  value: string
  isEditing?: boolean
  inputValue?: string
  inputLabel?: string
  hint?: string
  onInputBlur?: () => void
  onInputChange?: (value: string) => void
  onInputKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

export function DrawingDimensionLabel({
  position,
  value,
  isEditing = false,
  inputValue = '',
  inputLabel = 'Distance',
  hint = 'Enter to apply',
  onInputBlur,
  onInputChange,
  onInputKeyDown,
}: DrawingDimensionLabelProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) return

    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => cancelAnimationFrame(id)
  }, [isEditing])

  return (
    <Html
      center
      position={position}
      style={{ pointerEvents: isEditing ? 'auto' : 'none', userSelect: 'none' }}
      zIndexRange={[40, 0]}
    >
      <div
        className="min-w-[84px] rounded-xl border border-white/10 bg-zinc-950/90 px-2.5 py-1.5 text-center text-white shadow-2xl backdrop-blur-md"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
      >
        {isEditing ? (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
              {inputLabel}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                aria-label={inputLabel}
                className="h-8 w-20 rounded-md border border-white/10 bg-white/5 px-2 text-center font-mono text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/40"
                onBlur={onInputBlur}
                onChange={(event) => onInputChange?.(event.target.value)}
                onKeyDown={onInputKeyDown}
                ref={inputRef}
                type="text"
                value={inputValue}
              />
              <span className="font-mono text-xs text-zinc-400">m</span>
            </div>
            <div className="text-[10px] text-zinc-400">{hint}</div>
          </div>
        ) : (
          <div className="font-mono text-xs tracking-[0.08em]">{value}</div>
        )}
      </div>
    </Html>
  )
}
