'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'

interface MetricControlProps {
  label: React.ReactNode
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  precision?: number
  step?: number
  className?: string
  unit?: string
}

export function MetricControl({
  label,
  value,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  precision = 2,
  step = 1,
  className,
  unit = '',
}: MetricControlProps) {
  const viewerUnit = useViewer((state) => state.unit)
  const isImperial = viewerUnit === 'imperial' && unit === 'm'
  const multiplier = isImperial ? 3.280_84 : 1
  const displayUnit = isImperial ? 'ft' : unit

  const displayValue = value * multiplier

  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [inputValue, setInputValue] = useState(displayValue.toFixed(precision))
  const startXRef = useRef(0)
  const startValueRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const valueRef = useRef(value)
  valueRef.current = value

  const clamp = useCallback(
    (val: number) => {
      return Math.min(Math.max(val, min), max)
    },
    [min, max],
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
      let scrollStep = step / multiplier
      if (e.shiftKey) scrollStep = (step * 10) / multiplier
      else if (e.altKey) scrollStep = (step * 0.1) / multiplier

      const newValue = clamp(valueRef.current + direction * scrollStep)
      const finalValue = Number.parseFloat((newValue * multiplier).toFixed(precision)) / multiplier

      if (Math.abs(finalValue - valueRef.current) > 1e-6) {
        onChange(finalValue)
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [isEditing, step, clamp, onChange, precision, multiplier])

  useEffect(() => {
    if (!isHovered || isEditing) return

    const handleKeyDown = (e: KeyboardEvent) => {
      let direction = 0
      if (e.key === 'ArrowUp') direction = 1
      else if (e.key === 'ArrowDown') direction = -1

      if (direction !== 0) {
        e.preventDefault()
        let scrollStep = step / multiplier
        if (e.shiftKey) scrollStep = (step * 10) / multiplier
        else if (e.altKey) scrollStep = (step * 0.1) / multiplier

        const newValue = clamp(valueRef.current + direction * scrollStep)
        const finalValue =
          Number.parseFloat((newValue * multiplier).toFixed(precision)) / multiplier

        if (Math.abs(finalValue - valueRef.current) > 1e-6) {
          onChange(finalValue)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isHovered, isEditing, step, clamp, onChange, precision, multiplier])

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

        let dragStep = step / multiplier
        if (moveEvent.shiftKey) dragStep = (step * 10) / multiplier
        else if (moveEvent.altKey) dragStep = (step * 0.1) / multiplier

        const deltaValue = deltaX * dragStep
        const newValue = clamp(startValueRef.current + deltaValue)
        const newFinalValue =
          Number.parseFloat((newValue * multiplier).toFixed(precision)) / multiplier

        if (Math.abs(newFinalValue - finalValue) > 1e-6) {
          finalValue = newFinalValue
          onChange(finalValue)
        }
      }

      const handlePointerUp = () => {
        setIsDragging(false)
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)

        if (Math.abs(finalValue - startValueRef.current) > 1e-6) {
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
    [isEditing, value, onChange, clamp, precision, step, multiplier],
  )

  const handleValueClick = useCallback(() => {
    setIsEditing(true)
    setInputValue((value * multiplier).toFixed(precision))
  }, [value, multiplier, precision])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }, [])

  const submitValue = useCallback(() => {
    const numValue = Number.parseFloat(inputValue)
    if (Number.isNaN(numValue)) {
      setInputValue((value * multiplier).toFixed(precision))
    } else {
      onChange(clamp(numValue / multiplier))
    }
    setIsEditing(false)
  }, [inputValue, onChange, clamp, multiplier, value, precision])

  const handleInputBlur = useCallback(() => {
    submitValue()
  }, [submitValue])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        submitValue()
      } else if (e.key === 'Escape') {
        setInputValue((value * multiplier).toFixed(precision))
        setIsEditing(false)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const newV = clamp(value + step / multiplier)
        onChange(newV)
        setInputValue((newV * multiplier).toFixed(precision))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const newV = clamp(value - step / multiplier)
        onChange(newV)
        setInputValue((newV * multiplier).toFixed(precision))
      }
    },
    [submitValue, value, multiplier, precision, step, clamp, onChange],
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
            <input
              autoFocus
              className="w-full bg-transparent p-0 text-right font-mono text-foreground outline-none selection:bg-primary/30"
              onBlur={handleInputBlur}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              type="text"
              value={inputValue}
            />
            {displayUnit && <span className="ml-[1px] text-muted-foreground">{displayUnit}</span>}
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
