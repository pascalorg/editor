import { COLUMN_PRESETS, type ColumnNode, type ColumnPresetId } from '@pascal-app/core'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { columnPresetUpdates } from './presets'

const entries = Object.entries(COLUMN_PRESETS).map(([id, preset]) => ({
  id: id as ColumnPresetId,
  label: preset.label,
}))

export function ColumnPresetGallery({
  node,
  onPreview,
  onCancel,
  onApply,
}: {
  node: ColumnNode
  onPreview: (patch: Partial<ColumnNode>) => void
  onCancel: () => void
  onApply: (patch: Partial<ColumnNode>) => void
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const scrolling = useRef(false)
  const cancelPointerPreview = () => {
    if (!detailsRef.current?.querySelector('button:focus-visible')) onCancel()
  }
  const selected = entries.find(({ id }) =>
    Object.entries(columnPresetUpdates(id)).every(
      ([key, value]) => node[key as keyof ColumnNode] === value,
    ),
  )
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('blur', onCancel)
    return () => {
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('blur', onCancel)
      onCancel()
    }
  }, [onCancel])
  return (
    <details
      ref={detailsRef}
      className="group/presets"
      onPointerLeave={() => {
        scrolling.current = false
        cancelPointerPreview()
      }}
      onWheel={() => {
        scrolling.current = true
        onCancel()
      }}
      onToggle={(event) => {
        if (!event.currentTarget.open) onCancel()
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm hover:bg-accent/50 focus-visible:outline focus-visible:outline-orange-400 [&::-webkit-details-marker]:hidden">
        <img
          alt=""
          src={selected ? `/icons/column-presets/${selected.id}.webp` : '/icons/column.webp'}
          width={32}
          height={32}
          className="size-8 shrink-0 object-contain"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-muted-foreground">Shape presets</span>
          <span className="truncate">{selected?.label ?? 'Choose a shape'}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-open/presets:rotate-180" />
      </summary>
      <p className="py-2 text-xs text-muted-foreground">
        Hover or focus to preview; click to apply. Materials are kept. Escape cancels the preview.
      </p>
      <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto p-1">
        {entries.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            aria-label={`Apply ${label} shape`}
            aria-pressed={selected?.id === id}
            className="rounded-lg border border-border/50 p-1 text-xs hover:bg-orange-400/10 focus-visible:outline focus-visible:outline-orange-400"
            onPointerEnter={(event) => {
              if (event.pointerType !== 'touch' && !scrolling.current) {
                onCancel()
                onPreview(columnPresetUpdates(id))
              }
            }}
            onPointerMove={(event) => {
              // Scrolling moves cards under a stationary pointer. Resume only
              // after an intentional pointer movement, without a timing guess.
              if (scrolling.current && (event.movementX !== 0 || event.movementY !== 0)) {
                scrolling.current = false
                if (event.pointerType !== 'touch') {
                  onCancel()
                  onPreview(columnPresetUpdates(id))
                }
              }
            }}
            onPointerLeave={cancelPointerPreview}
            onPointerCancel={onCancel}
            onFocus={() => {
              onCancel()
              onPreview(columnPresetUpdates(id))
            }}
            onBlur={onCancel}
            onClick={() => {
              onApply(columnPresetUpdates(id))
              onCancel()
              if (detailsRef.current) detailsRef.current.open = false
              detailsRef.current?.querySelector('summary')?.focus()
            }}
          >
            <img
              alt=""
              src={`/icons/column-presets/${id}.webp`}
              width={256}
              height={256}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-24 w-full object-contain"
            />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </details>
  )
}
