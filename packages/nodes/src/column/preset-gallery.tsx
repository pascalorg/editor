import {
  COLUMN_PRESETS,
  type ColumnNode,
  type ColumnPresetId,
  type MessageDescriptor,
  usePascalI18n,
} from '@pascal-app/core'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { columnPresetUpdates } from './presets'

/** Preset names in the UI language; core's `COLUMN_PRESETS` labels stay English. */
const COLUMN_PRESET_LABELS: Record<ColumnPresetId, MessageDescriptor> = {
  basicPillar: /* i18n */ { id: 'node.column.preset.basicPillar', message: 'Straight Round' },
  squarePillar: /* i18n */ { id: 'node.column.preset.squarePillar', message: 'Square Block' },
  taperedPillar: /* i18n */ { id: 'node.column.preset.taperedPillar', message: 'Tapered Round' },
  bulgedPillar: /* i18n */ { id: 'node.column.preset.bulgedPillar', message: 'Soft Bulged' },
  hourglassPillar: /* i18n */ { id: 'node.column.preset.hourglassPillar', message: 'Hourglass' },
  aFrameSupport: /* i18n */ { id: 'node.column.preset.aFrameSupport', message: 'A-Frame Support' },
  yFrameSupport: /* i18n */ { id: 'node.column.preset.yFrameSupport', message: 'Y Support' },
  vFrameSupport: /* i18n */ { id: 'node.column.preset.vFrameSupport', message: 'V Support' },
  xBraceSupport: /* i18n */ { id: 'node.column.preset.xBraceSupport', message: 'X Brace' },
  kBraceSupport: /* i18n */ { id: 'node.column.preset.kBraceSupport', message: 'K Brace' },
  singleStrutSupport: /* i18n */ {
    id: 'node.column.preset.singleStrutSupport',
    message: 'Single Strut',
  },
  tripodSupport: /* i18n */ { id: 'node.column.preset.tripodSupport', message: 'Tripod Support' },
  trestleSupport: /* i18n */ { id: 'node.column.preset.trestleSupport', message: 'Trestle Frame' },
  portalFrameSupport: /* i18n */ {
    id: 'node.column.preset.portalFrameSupport',
    message: 'Portal Frame',
  },
  boxFrameSupport: /* i18n */ { id: 'node.column.preset.boxFrameSupport', message: 'Box Frame' },
}

const entries = Object.keys(COLUMN_PRESETS).map((id) => ({
  id: id as ColumnPresetId,
  label: COLUMN_PRESET_LABELS[id as ColumnPresetId],
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
  const i18n = usePascalI18n()
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
          <span className="text-xs text-muted-foreground">
            {i18n._({ id: 'node.column.presetGallery.shapePresets', message: 'Shape presets' })}
          </span>
          <span className="truncate">
            {(selected && i18n._(selected.label)) ??
              i18n._({ id: 'node.column.presetGallery.chooseAShape', message: 'Choose a shape' })}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-open/presets:rotate-180" />
      </summary>
      <p className="py-2 text-xs text-muted-foreground">
        {i18n._({
          id: 'node.column.presetGallery.hoverOrFocusToPreviewClick',
          message:
            'Hover or focus to preview; click to apply. Materials are kept. Escape cancels the preview.',
        })}
      </p>
      <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto p-1">
        {entries.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            aria-label={i18n._({
              id: 'node.column.presetGallery.applyLabelShape',
              message: 'Apply {label} shape',
              values: { label: i18n._(label) },
            })}
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
            <span>{i18n._(label)}</span>
          </button>
        ))}
      </div>
    </details>
  )
}
