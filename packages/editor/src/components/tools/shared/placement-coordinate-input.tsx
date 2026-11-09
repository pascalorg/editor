'use client'

import { usePascalI18n } from '@pascal-app/core'
import { type PlacementTypingField, usePlacementTyping } from '../../../store/use-placement-typing'

export type PlacementCoordinateInputProps = {
  /** What each empty field stands for; defaults to the session's `fieldDefaults`. */
  placeholders?: readonly string[]
}

/**
 * The typed-entry HUD, one box per field of the session. It only displays the
 * session: keys reach the active tool's own handler (`routePlacementTypingKey`),
 * so the same HUD can sit in the 3D view and the plan at once without
 * competing for focus. Clicking a field makes it the active one.
 */
export function PlacementCoordinateInput({ placeholders }: PlacementCoordinateInputProps) {
  const i18n = usePascalI18n()
  const isActive = usePlacementTyping((state) => state.isActive)
  const labels = usePlacementTyping((state) => state.labels)
  const fields = usePlacementTyping((state) => state.fields)
  const fieldDefaults = usePlacementTyping((state) => state.fieldDefaults)
  const activeField = usePlacementTyping((state) => state.activeField)

  if (!isActive) return null

  return (
    <div
      data-placement-coordinate-entry
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        alignItems: 'center',
        background: 'rgba(15, 23, 42, 0.94)',
        border: '1px solid rgba(148, 163, 184, 0.55)',
        borderRadius: 6,
        boxShadow: '0 4px 14px rgba(15, 23, 42, 0.28)',
        color: '#f8fafc',
        display: 'flex',
        gap: 6,
        padding: '5px 7px',
        pointerEvents: 'auto',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {labels.map((descriptor, index) => {
        const field = index as PlacementTypingField
        const label = i18n._(descriptor)
        const active = field === activeField
        const value = fields[field]
        return (
          <div
            data-placement-coordinate-field={descriptor.id}
            key={descriptor.id}
            onPointerDown={(event) => {
              event.stopPropagation()
              usePlacementTyping.getState().setActiveField(field)
            }}
            style={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 9,
              gap: 2,
              textTransform: 'uppercase',
            }}
          >
            <span style={{ color: active ? '#a5b4fc' : '#94a3b8' }}>{label}</span>
            <span
              aria-label={label}
              role="status"
              style={{
                background: active ? '#eef2ff' : '#e2e8f0',
                borderRadius: 3,
                color: value ? '#0f172a' : '#64748b',
                fontSize: 12,
                fontWeight: 600,
                minWidth: 76,
                outline: active ? '2px solid #818cf8' : 'none',
                padding: '3px 5px',
                textAlign: 'right',
                textTransform: 'none',
              }}
            >
              {value || placeholders?.[field] || fieldDefaults[field] || '\u00a0'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
