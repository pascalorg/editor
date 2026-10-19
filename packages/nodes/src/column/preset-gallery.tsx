import { COLUMN_PRESETS, type ColumnNode, type ColumnPresetId } from '@pascal-app/core'
import { useEffect } from 'react'
import { columnPresetUpdates } from './presets'

const entries = Object.entries(COLUMN_PRESETS).map(([id, preset]) => ({
  id: id as ColumnPresetId,
  label: preset.label,
}))

export function ColumnPresetGallery({
  onPreview,
  onCancel,
  onApply,
}: {
  onPreview: (patch: Partial<ColumnNode>) => void
  onCancel: () => void
  onApply: (patch: Partial<ColumnNode>) => void
}) {
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
      onToggle={(event) => {
        if (!event.currentTarget.open) onCancel()
      }}
    >
      <summary className="cursor-pointer rounded-lg border border-border/50 px-3 py-2 text-sm">
        Shape presets
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
            className="rounded-lg border border-border/50 p-1 text-xs hover:bg-orange-400/10 focus-visible:outline focus-visible:outline-orange-400"
            onPointerEnter={(event) => {
              if (event.pointerType !== 'touch') {
                onCancel()
                onPreview(columnPresetUpdates(id))
              }
            }}
            onPointerLeave={onCancel}
            onPointerCancel={onCancel}
            onFocus={() => {
              onCancel()
              onPreview(columnPresetUpdates(id))
            }}
            onBlur={onCancel}
            onClick={() => onApply(columnPresetUpdates(id))}
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
