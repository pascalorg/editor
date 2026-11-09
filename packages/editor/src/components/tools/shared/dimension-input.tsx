import { useCallback, useEffect, useRef } from 'react'
import { emitter, parseAngle, parseDimension } from '@pascal-app/core'

export interface DimensionInputState {
  active: boolean
  fieldType: 'length' | 'angle'
  lengthValue: string
  angleValue: string
  lockedLength: number | null
  lockedAngle: number | null
}

export const EMPTY_DIMENSION_STATE: DimensionInputState = {
  active: false,
  fieldType: 'length',
  lengthValue: '',
  angleValue: '',
  lockedLength: null,
  lockedAngle: null,
}

export function resolveDimensionPoint(
  startPoint: [number, number],
  state: DimensionInputState,
): [number, number] | null {
  if (state.lockedLength === null || state.lockedAngle === null) return null
  return [
    startPoint[0] + Math.cos((state.lockedAngle * Math.PI) / 180) * state.lockedLength,
    startPoint[1] + Math.sin((state.lockedAngle * Math.PI) / 180) * state.lockedLength,
  ]
}

interface DimensionInputProps {
  state: DimensionInputState
  onChange: (state: DimensionInputState) => void
  onConfirm: () => void
  onCancel: () => void
  position?: { x: number; y: number }
}

export function DimensionInput({
  state,
  onChange,
  onConfirm,
  onCancel,
  position,
}: DimensionInputProps) {
  const lengthRef = useRef<HTMLInputElement>(null)
  const angleRef = useRef<HTMLInputElement>(null)
  // Track fieldType locally so Tab can toggle it without depending on
  // the parent's onChange → setValues chain (which doesn't update fieldType).
  const fieldTypeRef = useRef(state.fieldType)

  useEffect(() => {
    fieldTypeRef.current = state.fieldType
  }, [state.fieldType])

  // Focus the correct input when fieldType changes
  useEffect(() => {
    if (!state.active) return
    const target = state.fieldType === 'length' ? lengthRef.current : angleRef.current
    if (target) {
      target.focus()
      target.select()
    }
  }, [state.active, state.fieldType])

  // Refocus input whenever dimension:focus is emitted (e.g. on digit shortcut entry)
  useEffect(() => {
    const handleFocus = (field: 'length' | 'angle') => {
      focusField(field)
    }
    emitter.on('dimension:focus', handleFocus)
    return () => {
      emitter.off('dimension:focus', handleFocus)
    }
  }, [focusField])

  const commitValues = useCallback(() => {
    const length = parseDimension(state.lengthValue)
    const angle = parseAngle(state.angleValue)
    if (length !== null && angle !== null) {
      onChange({
        ...state,
        lockedLength: length,
        lockedAngle: angle,
      })
    }
  }, [state, onChange])

  const focusField = useCallback((field: 'length' | 'angle') => {
    const target = field === 'length' ? lengthRef.current : angleRef.current
    if (target) {
      target.focus()
      target.select()
    }
  }, [])

  const handleLengthKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        fieldTypeRef.current = 'angle'
        onChange({ ...state, fieldType: 'angle' })
        // Focus angle input synchronously, don't wait for useEffect
        requestAnimationFrame(() => focusField('angle'))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        commitValues()
        onConfirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    },
    [state, onChange, commitValues, onConfirm, onCancel, focusField],
  )

  const handleAngleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        fieldTypeRef.current = 'length'
        onChange({ ...state, fieldType: 'length' })
        requestAnimationFrame(() => focusField('length'))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        commitValues()
        onConfirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    },
    [state, onChange, commitValues, onConfirm, onCancel, focusField],
  )

  const handleLengthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      const length = parseDimension(value)
      onChange({
        ...state,
        lengthValue: value,
        lockedLength: length,
      })
    },
    [state, onChange],
  )

  const handleAngleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      const angle = parseAngle(value)
      onChange({
        ...state,
        angleValue: value,
        lockedAngle: angle,
      })
    },
    [state, onChange],
  )

  const handleLengthBlur = useCallback(() => {
    commitValues()
  }, [commitValues])

  const handleAngleBlur = useCallback(() => {
    commitValues()
  }, [commitValues])

  if (!state.active) return null

  const style: React.CSSProperties = position
    ? { position: 'fixed', left: position.x + 20, top: position.y - 40, zIndex: 1000 }
    : { position: 'relative' }

  return (
    <div
      style={style}
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-zinc-600 bg-zinc-900/95 px-2 py-1.5 shadow-lg backdrop-blur-sm"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1">
        <span className="text-[11px] font-medium text-zinc-400">L</span>
        <input
          ref={lengthRef}
          type="text"
          value={state.lengthValue}
          onChange={handleLengthChange}
          onKeyDown={handleLengthKeyDown}
          onBlur={handleLengthBlur}
          onFocus={() => onChange({ ...state, fieldType: 'length' })}
          placeholder="0.00m"
          className="w-20 bg-transparent font-mono text-sm text-white outline-none placeholder:text-zinc-600"
        />
      </label>

      <div className="h-4 w-px bg-zinc-600" />

      <label className="flex items-center gap-1">
        <span className="text-[11px] font-medium text-zinc-400">A</span>
        <input
          ref={angleRef}
          type="text"
          value={state.angleValue}
          onChange={handleAngleChange}
          onKeyDown={handleAngleKeyDown}
          onBlur={handleAngleBlur}
          onFocus={() => onChange({ ...state, fieldType: 'angle' })}
          placeholder="0°"
          className="w-16 bg-transparent font-mono text-sm text-white outline-none placeholder:text-zinc-600"
        />
      </label>
    </div>
  )
}
