'use client'

import { useScene } from '@pascal-app/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'

interface SliderControlProps {
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
}

function stepPrecision(s: number): number {
  if (s <= 0) return 0
  return Math.max(0, Math.ceil(-Math.log10(s)))
}

function getStepMultiplier(modifiers: {
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}): number {
  if (modifiers.shiftKey) return 10
  if (modifiers.metaKey || modifiers.ctrlKey || modifiers.altKey) return 0.1
  return 1
}

function getAdjustedStep(
  baseStep: number,
  modifiers: {
    shiftKey?: boolean
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
  },
): number {
  return baseStep * getStepMultiplier(modifiers)
}

export function SliderControl({
  label,
  value,
  onChange,
  onCommit,
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

  const dragRef = useRef<{
    // Original value at drag start — preserved across modifier re-anchors so
    // undo/redo rolls back to the pre-drag state, not to a mid-drag anchor.
    originValue: number
    // Anchor pointer position and value — updated whenever modifier keys
    // change so the delta calculation continues smoothly from the current
    // position at the new step size.
    anchorX: number
    anchorValue: number
    stepMultiplier: number
  } | null>(null)
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
      const s = getAdjustedStep(step, e)
      const newValue = clamp(valueRef.current + direction * s)
      const final = Number.parseFloat(newValue.toFixed(stepPrecision(s)))
      if (final !== valueRef.current) onChange(final)
      onCommit?.(final)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [isEditing, step, clamp, onChange, onCommit])

  // Arrow key support while hovered
  useEffect(() => {
    if (!isHovered || isEditing) return
    const handleKeyDown = (e: KeyboardEvent) => {
      let direction = 0
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') direction = 1
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') direction = -1
      if (direction !== 0) {
        e.preventDefault()
        const s = getAdjustedStep(step, e)
        const newValue = clamp(valueRef.current + direction * s)
        const final = Number.parseFloat(newValue.toFixed(stepPrecision(s)))
        if (final !== valueRef.current) onChange(final)
        onCommit?.(final)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isHovered, isEditing, step, clamp, onChange, onCommit])

  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isEditing) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        originValue: valueRef.current,
        anchorX: e.clientX,
        anchorValue: valueRef.current,
        stepMultiplier: getStepMultiplier(e),
      }
      setIsDragging(true)
      useScene.temporal.getState().pause()
    },
    [isEditing],
  )

  const handleLabelPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      const multiplier = getStepMultiplier(e)
      // If modifier keys changed mid-drag, re-anchor from the current pointer
      // position and value — otherwise the accumulated dx would be applied
      // with a new step size and jump the value (e.g. pressing Cmd while
      // already far from the starting point would snap back toward it).
      if (multiplier !== dragRef.current.stepMultiplier) {
        dragRef.current.anchorX = e.clientX
        dragRef.current.anchorValue = valueRef.current
        dragRef.current.stepMultiplier = multiplier
        return
      }
      const { anchorX, anchorValue } = dragRef.current
      const dx = e.clientX - anchorX
      const s = step * multiplier
      // 4 px per step at default sensitivity
      const newValue = clamp(
        Number.parseFloat((anchorValue + (dx / 4) * s).toFixed(stepPrecision(s))),
      )
      onChange(newValue)
    },
    [step, clamp, onChange],
  )

  const handleLabelPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      const { originValue } = dragRef.current
      const finalVal = valueRef.current
      dragRef.current = null
      setIsDragging(false)
      e.currentTarget.releasePointerCapture(e.pointerId)

      if (originValue !== finalVal) {
        onChange(originValue)
        useScene.temporal.getState().resume()
        onChange(finalVal)
        onCommit?.(finalVal)
      } else {
        useScene.temporal.getState().resume()
        onCommit?.(finalVal)
      }
    },
    [onChange, onCommit],
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
      const nextValue = clamp(Number.parseFloat(numValue.toFixed(precision)))
      onChange(nextValue)
      onCommit?.(nextValue)
    }
    setIsEditing(false)
  }, [inputValue, onChange, onCommit, clamp, precision, value])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        submitValue()
      } else if (e.key === 'Escape') {
        setInputValue(value.toFixed(precision))
        setIsEditing(false)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const adjustedStep = getAdjustedStep(step, e)
        const newV = clamp(
          Number.parseFloat((value + adjustedStep).toFixed(stepPrecision(adjustedStep))),
        )
        onChange(newV)
        setInputValue(newV.toFixed(precision))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const adjustedStep = getAdjustedStep(step, e)
        const newV = clamp(
          Number.parseFloat((value - adjustedStep).toFixed(stepPrecision(adjustedStep))),
        )
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
            <span className="font-mono tabular-nums tracking-tight" suppressHydrationWarning>
              {Number(value.toFixed(precision)).toFixed(precision)}
            </span>
            {unit && <span className="ml-[1px] text-muted-foreground">{unit}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
