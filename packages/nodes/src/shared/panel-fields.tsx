'use client'

import { useEffect, useRef, useState } from 'react'

export function PanelTextField({
  label,
  onCommit,
  value,
}: {
  label: string
  onCommit: (value: string) => void
  value: string
}) {
  const [draft, setDraft] = useState(value)
  const cancelRef = useRef(false)

  useEffect(() => setDraft(value), [value])

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(value)
      return
    }
    const next = draft.trim()
    if (next !== value) onCommit(next)
    else setDraft(value)
  }

  return (
    <label className="flex h-10 items-center gap-3 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-right text-foreground outline-none selection:bg-primary/30"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            cancelRef.current = true
            event.currentTarget.blur()
          }
        }}
        type="text"
        value={draft}
      />
    </label>
  )
}

export function PanelSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ label: string; value: string }>
  value: string
}) {
  return (
    <label className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="min-w-0 rounded-md border border-border/50 bg-[#232325] px-2 py-1 text-foreground text-xs outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
