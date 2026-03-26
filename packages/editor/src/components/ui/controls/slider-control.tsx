'use client'

import { useScene } from '@pascal-app/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'

interface SliderControlProps {
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

export function SliderControl({
  label,
  value,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  precision = 0,
  step = 1,
  className,
  unit = '',
}: SliderControlProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [inputValue, setInputValue] = useState(value.toFixed(precision))

  const dragRef = useRef<{ startX: number; startValue: number } | null>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const clamp = useCallback((val: number) => Math.min(Math.max(val, min), max), [min, max])

  useEffect(() => {
    if (!isEditing) {
      setInputValue(value.toFixed(precision))
    }
  }, [value, precision, isEditing])

  // Wheel support on the label
  useEffect(() => {
    const el = labelRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if (isEditing) return
      e.preventDefault()
      const direction = e.deltaY < 0 ? 1 : -1
      let s = step
      if (e.shiftKey) s = step * 10
      else if (e.altKey) s = step * 0.1
      const newValue = clamp(valueRef.current + direction * s)
      const final = Number.parseFloat(newValue.toFixed(precision))
      if (final !== valueRef.current) onChange(final)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [isEditing, step, clamp, onChange, precision])

  // Arrow key support while hovered
  useEffect(() => {
    if (!isHovered || isEditing) return
    const handleKeyDown = (e: KeyboardEvent) => {
      let direction = 0
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') direction = 1
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') direction = -1
      if (direction !== 0) {
        e.preventDefault()
        let s = step
        if (e.shiftKey) s = step * 10
        else if (e.metaKey || e.ctrlKey) s = step * 0.1
        const newValue = clamp(valueRef.current + direction * s)
        const final = Number.parseFloat(newValue.toFixed(precision))
        if (final !== valueRef.current) onChange(final)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isHovered, isEditing, step, clamp, onChange, precision])

  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isEditing) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startX: e.clientX, startValue: valueRef.current }
      setIsDragging(true)
      useScene.temporal.getState().pause()
    },
    [isEditing],
  )

  const handleLabelPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      const { startX, startValue } = dragRef.current
      const dx = e.clientX - startX
      let s = step
      if (e.shiftKey) s = step * 10
      else if (e.metaKey || e.ctrlKey) s = step * 0.1
      // 4 px per step at default sensitivity
      const newValue = clamp(Number.parseFloat((startValue + (dx / 4) * s).toFixed(precision)))
      onChange(newValue)
    },
    [step, precision, clamp, onChange],
  )

  const handleLabelPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      const { startValue } = dragRef.current
      const finalVal = valueRef.current
      dragRef.current = null
      setIsDragging(false)
      e.currentTarget.releasePointerCapture(e.pointerId)

      if (startValue !== finalVal) {
        onChange(startValue)
        useScene.temporal.getState().resume()
        onChange(finalVal)
      } else {
        useScene.temporal.getState().resume()
      }
    },
    [onChange],
  )

  const handleValueClick = useCallback(() => {
    setIsEditing(true)
    setInputValue(value.toFixed(precision))
  }, [value, precision])

  const submitValue = useCallback(() => {
    const numValue = Number.parseFloat(inputValue)
    if (Number.isNaN(numValue)) {
      setInputValue(value.toFixed(precision))
    } else {
      onChange(clamp(Number.parseFloat(numValue.toFixed(precision))))
    }
    setIsEditing(false)
  }, [inputValue, onChange, clamp, precision, value])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        submitValue()
      } else if (e.key === 'Escape') {
        setInputValue(value.toFixed(precision))
        setIsEditing(false)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const newV = clamp(value + step)
        onChange(newV)
        setInputValue(newV.toFixed(precision))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const newV = clamp(value - step)
        onChange(newV)
        setInputValue(newV.toFixed(precision))
      }
    },
    [submitValue, value, precision, step, clamp, onChange],
  )

  return (
    <div
      className={cn(
        'group flex h-7 w-full select-none items-center rounded-lg px-2 transition-colors',
        isDragging ? 'bg-white/5' : 'hover:bg-white/5',
        className,
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Label — drag handle */}
      <div
        className={cn(
          'flex shrink-0 cursor-ew-resize items-center gap-1.5 text-xs transition-colors',
          isDragging ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
        )}
        onPointerDown={handleLabelPointerDown}
        onPointerMove={handleLabelPointerMove}
        onPointerUp={handleLabelPointerUp}
        ref={labelRef}
      >
        {/* Grip dots — 2×3 grid */}
        <div
          className={cn(
            'grid grid-cols-2 gap-[2.5px] transition-opacity',
            isDragging ? 'opacity-70' : 'opacity-25 group-hover:opacity-50',
          )}
        >
          {[...Array(6)].map((_, i) => (
            <div className="h-[2px] w-[2px] rounded-full bg-current" key={i} />
          ))}
        </div>
        <span className="font-medium">{label}</span>
      </div>

      <div className="flex-1" />

      {/* Value — click to edit */}
      <div className="flex items-center text-xs">
        {isEditing ? (
          <>
            <input
              autoFocus
              className="w-14 bg-transparent p-0 text-right font-mono text-foreground outline-none selection:bg-primary/30"
              onBlur={submitValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              type="text"
              value={inputValue}
            />
            {unit && <span className="ml-[1px] text-muted-foreground">{unit}</span>}
          </>
        ) : (
          <div
            className="flex cursor-text items-center text-foreground/60 transition-colors hover:text-foreground"
            onClick={handleValueClick}
          >
            <span className="font-mono tabular-nums tracking-tight">
              {Number(value.toFixed(precision)).toFixed(precision)}
            </span>
            {unit && <span className="ml-[1px] text-muted-foreground">{unit}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
