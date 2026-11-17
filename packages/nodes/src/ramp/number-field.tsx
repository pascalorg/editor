'use client'

import { useEffect, useRef, useState } from 'react'

export function RampNumberField({
  label,
  value,
  onCommit,
  unit = 'm',
  min,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
  unit?: string
  min?: number
}) {
  const [text, setText] = useState(String(value))
  const cancelled = useRef(false)
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const next = Number(text)
    if (
      text.trim() &&
      Number.isFinite(next) &&
      (min === undefined || next >= min) &&
      next !== value
    )
      onCommit(next)
    setText(String(value))
  }
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-xs">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          aria-label={label}
          className="w-24 rounded border border-border bg-background px-2 py-1"
          min={min}
          onBlur={commit}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              cancelled.current = true
              setText(String(value))
              event.currentTarget.blur()
            }
          }}
          step="0.01"
          type="number"
          value={text}
        />
        <span className="w-4 text-muted-foreground">{unit}</span>
      </span>
    </label>
  )
}
