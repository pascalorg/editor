'use client'

import { useEffect, useRef } from 'react'
import { usePlacementTyping } from '../../../store/use-placement-typing'

const FIELD_LABELS = ['Distance', 'Offset'] as const

export type PlacementCoordinateInputProps = {
  className?: string
}

export function PlacementCoordinateInput({ className }: PlacementCoordinateInputProps) {
  const isActive = usePlacementTyping((state) => state.isActive)
  const fields = usePlacementTyping((state) => state.fields)
  const fieldDefaults = usePlacementTyping((state) => state.fieldDefaults)
  const activeField = usePlacementTyping((state) => state.activeField)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    const input = inputRefs.current[activeField]
    if (!isActive || !input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [activeField, isActive])

  if (!isActive) return null

  return (
    <div
      className={className}
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
      }}
    >
      {FIELD_LABELS.map((label, index) => {
        const field = index as 0 | 1
        return (
          <label
            key={label}
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
            <span style={{ color: field === activeField ? '#a5b4fc' : '#94a3b8' }}>{label}</span>
            <input
              aria-label={label}
              data-placement-coordinate-field={label.toLowerCase()}
              onChange={(event) =>
                usePlacementTyping.getState().setField(field, event.target.value)
              }
              onFocus={() => usePlacementTyping.getState().setActiveField(field)}
              onKeyDown={(event) => {
                if (event.key === 'Tab' || event.key === ',') {
                  event.preventDefault()
                  event.stopPropagation()
                  usePlacementTyping.getState().toggleField()
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.stopPropagation()
                  usePlacementTyping.getState().requestCommit()
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  usePlacementTyping.getState().clear()
                }
              }}
              placeholder={fieldDefaults[field] || (field === 0 ? 'distance' : '0')}
              ref={(element) => {
                inputRefs.current[field] = element
              }}
              spellCheck={false}
              style={{
                background: field === activeField ? '#eef2ff' : '#e2e8f0',
                border: 'none',
                borderRadius: 3,
                color: '#0f172a',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
                outline: field === activeField ? '2px solid #818cf8' : 'none',
                padding: '3px 5px',
                textAlign: 'right',
                width: 76,
              }}
              value={fields[field]}
            />
          </label>
        )
      })}
    </div>
  )
}
