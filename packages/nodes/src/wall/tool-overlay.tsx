import {
  runDrawingControl,
  useDraftLength,
  useEditor,
  useFloorplanDraftPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'

function LengthField({ unit, scale }: { unit: string; scale: number }) {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(() => {
    const current = useDraftLength.getState().length
    return current === null ? '' : String(Number((current / scale).toPrecision(12)))
  })
  const value = /^\d*\.?\d+$/.test(text.trim()) ? Number(text) * scale : null
  const invalid = text !== '' && (value === null || !Number.isFinite(value) || value < 0.01)

  const update = useCallback(
    (next: string) => {
      setText(next)
      if (next === '') useDraftLength.getState().clear()
      else if (/^\d*\.?\d+$/.test(next.trim())) {
        useDraftLength.getState().setLength(Number(next) * scale)
      }
    },
    [scale],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const ownInput = target === input.current
      if (
        !ownInput &&
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
      )
        return

      if (event.key === 'Escape' && (ownInput || useDraftLength.getState().length !== null)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setText('')
        useDraftLength.getState().clear()
        input.current?.blur()
      } else if (ownInput && event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (
          !invalid &&
          !event.repeat &&
          runDrawingControl('wall', 'finish', useEditor.getState().viewMode)
        ) {
          input.current?.blur()
        }
      } else if (!ownInput && /^[0-9.]$/.test(event.key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        update(event.key)
        input.current?.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [invalid, update])

  return (
    <div
      className="pointer-events-auto fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-1.5 text-foreground shadow-sm focus-within:ring-1 focus-within:ring-ring"
      title="Type a length · Enter or click to place · Esc to clear"
    >
      <input
        aria-describedby={invalid ? 'wall-draft-length-hint' : undefined}
        aria-invalid={invalid}
        aria-label={`Wall length (${unit})`}
        className="w-20 bg-transparent text-sm tabular-nums outline-none placeholder:text-muted-foreground"
        id="wall-draft-length"
        inputMode="decimal"
        onBlur={() => {
          const current = useDraftLength.getState().length
          setText(current === null ? '' : String(Number((current / scale).toPrecision(12))))
        }}
        onChange={(event) => update(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder="Length"
        ref={input}
        value={text}
      />
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        {unit}
      </span>
      {invalid && (
        <p
          className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-background px-2 py-1 text-xs text-destructive shadow-sm"
          id="wall-draft-length-hint"
          role="status"
        >
          Enter a length of at least 1 cm.
        </p>
      )}
    </div>
  )
}

export default function WallToolOverlay() {
  const start = useFloorplanDraftPreview((state) => state.wallDraftStart)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const label = unit === 'imperial' ? 'ft' : metricNotation === 'millimeters' ? 'mm' : 'm'
  const scale = label === 'ft' ? 0.3048 : label === 'mm' ? 0.001 : 1
  useEffect(() => () => useDraftLength.getState().clear(), [])
  if (!start) return null
  return <LengthField key={`${start[0]},${start[1]},${label}`} scale={scale} unit={label} />
}
