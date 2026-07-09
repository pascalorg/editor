'use client'

import { useScene } from '@pascal-app/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  lingoUnitSpec,
  measurementHint,
  parseMeasurement,
} from '../../../lib/measurement-parser'
import { useLinearDisplay } from '../../../lib/use-linear-display'
import { cn } from '../../../lib/utils'

interface MetricControlProps {
  label: React.ReactNode
  value: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  min?: number
  max?: number
  precision?: number
  step?: number
  className?: string
  unit?: string
  restoreOnCommit?: boolean
}

export function MetricControl({
  label,
  value,
  onChange,
  onCommit,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  precision = 2,
  step = 1,
  className,
  unit = '',
  restoreOnCommit = true,
}: MetricControlProps) {
  const {
    isImperial,
    displayUnit,
    toDisplay: toDisplayValue,
    toStored: toStoredValue,
  } = useLinearDisplay(unit, precision)

  const clamp = useCallback(
    (val: number) => {
      return Math.min(Math.max(val, min), max)
    },
    [min, max],
  )
  const roundStoredValueForDisplayPrecision = useCallback(
    (storedValue: number) =>
      clamp(toStoredValue(Number.parseFloat(toDisplayValue(storedValue).toFixed(precision)))),
    [clamp, precision, toDisplayValue, toStoredValue],
  )

  const displayValue = toDisplayValue(value)

  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [inputValue, setInputValue] = useState(displayValue.toFixed(precision))
  const startXRef = useRef(0)
  const startValueRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const valueRef = useRef(value)
  valueRef.current = value

  const applyCommittedValue = useCallback(
    (nextValue: number) => {
      if (onCommit) {
        onCommit(nextValue)
      } else {
        onChange(nextValue)
      }
    },
    [onChange, onCommit],
  )

  useEffect(() => {
    if (!isEditing) {
      setInputValue(displayValue.toFixed(precision))
    }
  }, [displayValue, precision, isEditing])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (isEditing) return

      e.preventDefault()

      const direction = e.deltaY < 0 ? 1 : -1
      let scrollStep = toStoredValue(step)
      if (e.shiftKey) scrollStep = toStoredValue(step * 10)
      else if (e.altKey) scrollStep = toStoredValue(step * 0.1)

      const newValue = clamp(valueRef.current + direction * scrollStep)
      const finalValue = roundStoredValueForDisplayPrecision(newValue)

      if (Math.abs(finalValue - valueRef.current) > 1e-6) {
        applyCommittedValue(finalValue)
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [isEditing, step, clamp, applyCommittedValue, toStoredValue, roundStoredValueForDisplayPrecision])

  useEffect(() => {
    if (!isHovered || isEditing) return

    const handleKeyDown = (e: KeyboardEvent) => {
      let direction = 0
      if (e.key === 'ArrowUp') direction = 1
      else if (e.key === 'ArrowDown') direction = -1

      if (direction !== 0) {
        e.preventDefault()
        let scrollStep = toStoredValue(step)
        if (e.shiftKey) scrollStep = toStoredValue(step * 10)
        else if (e.altKey) scrollStep = toStoredValue(step * 0.1)

        const newValue = clamp(valueRef.current + direction * scrollStep)
        const finalValue = roundStoredValueForDisplayPrecision(newValue)

        if (Math.abs(finalValue - valueRef.current) > 1e-6) {
          applyCommittedValue(finalValue)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isHovered,
    isEditing,
    step,
    clamp,
    applyCommittedValue,
    toStoredValue,
    roundStoredValueForDisplayPrecision,
  ])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isEditing) return
      e.preventDefault()

      setIsDragging(true)
      startXRef.current = e.clientX
      startValueRef.current = value
      useScene.temporal.getState().pause()

      let finalValue = value

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startXRef.current

        let dragStep = toStoredValue(step)
        if (moveEvent.shiftKey) dragStep = toStoredValue(step * 10)
        else if (moveEvent.altKey) dragStep = toStoredValue(step * 0.1)

        const deltaValue = deltaX * dragStep
        const newValue = clamp(startValueRef.current + deltaValue)
        const newFinalValue = roundStoredValueForDisplayPrecision(newValue)

        if (Math.abs(newFinalValue - finalValue) > 1e-6) {
          finalValue = newFinalValue
          onChange(finalValue)
        }
      }

      const handlePointerUp = () => {
        setIsDragging(false)
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)

        const changed = Math.abs(finalValue - startValueRef.current) > 1e-6
        if (onCommit) {
          if (changed && restoreOnCommit) {
            onChange(startValueRef.current)
          }
          useScene.temporal.getState().resume()
          onCommit(finalValue)
        } else if (changed) {
          onChange(startValueRef.current)
          useScene.temporal.getState().resume()
          onChange(finalValue)
        } else {
          useScene.temporal.getState().resume()
        }
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [
      isEditing,
      value,
      onChange,
      onCommit,
      restoreOnCommit,
      clamp,
      step,
      toStoredValue,
      roundStoredValueForDisplayPrecision,
    ],
  )

  const handleValueClick = useCallback(() => {
    setIsEditing(true)
    setInputValue(toDisplayValue(value).toFixed(precision))
  }, [value, toDisplayValue, precision])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }, [])

  const submitValue = useCallback(() => {
    const spec = lingoUnitSpec(unit)
    let stored = spec
      ? parseMeasurement(inputValue, spec, {
          bareUnit: isImperial ? 'ft' : spec.unitId,
          system: isImperial ? 'us' : 'metric',
        })
      : null
    if (stored === null) {
      const numValue = Number.parseFloat(inputValue)
      stored = Number.isFinite(numValue) ? toStoredValue(numValue) : null
    }
    if (stored === null) {
      setInputValue(toDisplayValue(value).toFixed(precision))
    } else {
      applyCommittedValue(clamp(stored))
    }
    setIsEditing(false)
  }, [
    inputValue,
    unit,
    isImperial,
    applyCommittedValue,
    clamp,
    toStoredValue,
    value,
    precision,
    toDisplayValue,
  ])

  const spec = lingoUnitSpec(unit)
  const hint =
    isEditing && spec
      ? measurementHint(inputValue, spec, {
          bareUnit: isImperial ? 'ft' : spec.unitId,
          system: isImperial ? 'us' : 'metric',
          displayUnit: isImperial ? 'ft' : spec.unitId,
          precision,
          clamp,
        })
      : null

  const handleInputBlur = useCallback(() => {
    submitValue()
  }, [submitValue])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        submitValue()
      } else if (e.key === 'Escape') {
        setInputValue(toDisplayValue(value).toFixed(precision))
        setIsEditing(false)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const newV = clamp(value + toStoredValue(step))
        applyCommittedValue(newV)
        setInputValue(toDisplayValue(newV).toFixed(precision))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const newV = clamp(value - toStoredValue(step))
        applyCommittedValue(newV)
        setInputValue(toDisplayValue(newV).toFixed(precision))
      }
    },
    [submitValue, value, toDisplayValue, precision, step, clamp, applyCommittedValue, toStoredValue],
  )

  return (
    <div
      className={cn(
        'group flex h-10 w-full items-center justify-between rounded-lg border border-border/50 px-3 text-sm transition-colors',
        isDragging ? 'bg-[#3e3e3e]' : 'bg-[#2C2C2E] hover:bg-[#3e3e3e]',
        className,
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      ref={containerRef}
    >
      <div
        className={cn(
          'select-none truncate text-muted-foreground transition-colors',
          isDragging
            ? 'cursor-ew-resize text-foreground'
            : 'hover:cursor-ew-resize hover:text-foreground',
        )}
        onPointerDown={handlePointerDown}
      >
        {label}
      </div>

      <div className="flex shrink-0 justify-end">
        {isEditing ? (
          <div className="flex items-center">
            {hint && (
              <span className="mr-1.5 shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/50 tabular-nums">
                {hint}
              </span>
            )}
            <input
              autoFocus
              className="w-full bg-transparent p-0 text-right font-mono text-foreground outline-none selection:bg-primary/30"
              onBlur={handleInputBlur}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              type="text"
              value={inputValue}
            />
            {displayUnit && (
              <span
                className={cn(
                  'ml-[1px] transition-opacity duration-150',
                  hint ? 'opacity-0' : 'text-muted-foreground/40',
                )}
              >
                {displayUnit}
              </span>
            )}
          </div>
        ) : (
          <div
            className="flex w-full cursor-text items-center justify-end text-foreground transition-colors hover:text-primary"
            onClick={handleValueClick}
          >
            <span className="font-mono tabular-nums tracking-tight">
              {Number(displayValue.toFixed(precision)).toFixed(precision)}
            </span>
            {displayUnit && <span className="ml-[1px] text-muted-foreground">{displayUnit}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
