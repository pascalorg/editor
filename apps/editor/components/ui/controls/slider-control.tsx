'use client'

import { useScene } from '@pascal-app/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

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
  min = 0,
  max = 100,
  precision = 0,
  step = 1,
  className,
  unit = '',
}: SliderControlProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [inputValue, setInputValue] = useState(value.toFixed(precision))
  
  // Track the original value and bounds when dragging starts
  const [dragStartValue, setDragStartValue] = useState<number | null>(null)
  const [dragMin, setDragMin] = useState<number | null>(null)
  const [dragMax, setDragMax] = useState<number | null>(null)
  
  const trackRef = useRef<HTMLDivElement>(null)
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
      setInputValue(value.toFixed(precision))
    }
  }, [value, precision, isEditing])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (isEditing) return
      
      e.preventDefault()
      
      const direction = e.deltaY < 0 ? 1 : -1
      let scrollStep = step
      if (e.shiftKey) scrollStep = step * 10
      else if (e.altKey) scrollStep = step * 0.1

      const newValue = clamp(valueRef.current + direction * scrollStep)
      const finalValue = Number.parseFloat(newValue.toFixed(precision))
      
      if (finalValue !== valueRef.current) {
        onChange(finalValue)
      }
    }
    
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [isEditing, step, clamp, onChange, precision])

  useEffect(() => {
    if (!isHovered || isEditing) return

    const handleKeyDown = (e: KeyboardEvent) => {
      let direction = 0
      if (e.key === 'ArrowUp') direction = 1
      else if (e.key === 'ArrowDown') direction = -1
      
      if (direction !== 0) {
        e.preventDefault()
        let scrollStep = step
        if (e.shiftKey) scrollStep = step * 10
        else if (e.altKey) scrollStep = step * 0.1
        
        const newValue = clamp(valueRef.current + direction * scrollStep)
        const finalValue = Number.parseFloat(newValue.toFixed(precision))
        
        if (finalValue !== valueRef.current) {
          onChange(finalValue)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isHovered, isEditing, step, clamp, onChange, precision])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isEditing) return
      e.preventDefault()
      
      const track = trackRef.current
      if (!track) return

      setIsDragging(true)
      setDragStartValue(value)
      setDragMin(min)
      setDragMax(max)
      useScene.temporal.getState().pause()
      
      const rect = track.getBoundingClientRect()
      const updateValueFromEvent = (clientX: number) => {
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        const rawValue = min + percent * (max - min)
        // snap to step
        const snapped = Math.round(rawValue / step) * step
        const finalValue = Number.parseFloat(clamp(snapped).toFixed(precision))
        onChange(finalValue)
      }

      updateValueFromEvent(e.clientX)

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateValueFromEvent(moveEvent.clientX)
      }

      const handlePointerUp = (e: PointerEvent) => {
        // Only stop dragging if we didn't release on the reset button
        // Let the reset button's onPointerDown handle its own cleanup
        if ((e.target as HTMLElement).closest('button')) {
          return
        }
        
        setIsDragging(false)
        setDragStartValue(null)
        setDragMin(null)
        setDragMax(null)
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
        useScene.temporal.getState().resume()
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [isEditing, min, max, step, precision, clamp, onChange]
  )

  const handleValueClick = useCallback(() => {
    setIsEditing(true)
    setInputValue(value.toFixed(precision))
  }, [value, precision])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }, [])

  const submitValue = useCallback(() => {
    const numValue = Number.parseFloat(inputValue)
    if (!Number.isNaN(numValue)) {
      onChange(clamp(Number.parseFloat(numValue.toFixed(precision))))
    } else {
      setInputValue(value.toFixed(precision))
    }
    setIsEditing(false)
  }, [inputValue, onChange, clamp, precision, value])

  const handleInputBlur = useCallback(() => {
    submitValue()
  }, [submitValue])

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

  const currentMin = isDragging && dragMin !== null ? dragMin : min
  const currentMax = isDragging && dragMax !== null ? dragMax : max

  const percent = Math.max(0, Math.min(100, ((value - currentMin) / (currentMax - currentMin)) * 100))
  const startPercent = dragStartValue !== null ? Math.max(0, Math.min(100, ((dragStartValue - currentMin) / (currentMax - currentMin)) * 100)) : null

  return (
    <div 
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn("group flex h-12 w-full items-center rounded-lg border border-border/50 px-3 text-sm transition-colors relative", isDragging ? "bg-[#3e3e3e]" : "bg-[#2C2C2E] hover:bg-[#3e3e3e]", className)}
    >
      {/* Reset button that appears when dragged away from start */}
      {isDragging && dragStartValue !== null && dragStartValue !== value && (
        <button
          className="absolute -top-10 right-0 rounded-md bg-[#2C2C2E] px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm ring-1 ring-border/50 hover:bg-[#3e3e3e] hover:text-foreground z-50 pointer-events-auto cursor-pointer"
          onPointerDown={(e) => {
            e.stopPropagation()
            onChange(dragStartValue)
            setDragStartValue(null)
            setDragMin(null)
            setDragMax(null)
            setIsDragging(false)
            useScene.temporal.getState().resume()
          }}
        >
          Reset
        </button>
      )}

      <div className="w-[80px] shrink-0 text-muted-foreground select-none truncate">
        {label}
      </div>
      
      <div 
        ref={trackRef}
        className={cn(
          "relative flex h-full flex-1 items-center justify-center touch-none mx-2",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={handlePointerDown}
      >
        {/* Track dots background */}
        <div className="absolute inset-x-0 flex items-center justify-between opacity-30 px-1 pointer-events-none">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="h-[3px] w-[3px] rounded-full bg-current" />
          ))}
        </div>
        
        {/* Original Thumb Ghost */}
        {isDragging && startPercent !== null && (
          <div 
            className="absolute top-1/2 h-6 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm bg-foreground/20 pointer-events-none"
            style={{ left: `${startPercent}%` }}
          />
        )}
        
        {/* Active Thumb */}
        <div 
          className={cn(
            "absolute top-1/2 h-6 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm transition pointer-events-none",
            isDragging ? "bg-foreground scale-y-110" : "bg-foreground/60 group-hover:bg-foreground/80"
          )}
          style={{ left: `${percent}%` }}
        />
      </div>

      <div className="flex w-[50px] shrink-0 justify-end">
        {isEditing ? (
          <div className="flex items-center">
            <input
              autoFocus
              className="w-full bg-transparent p-0 text-right text-foreground font-mono outline-none selection:bg-primary/30"
              onBlur={handleInputBlur}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              type="text"
              value={inputValue}
            />
            {unit && <span className="ml-[1px] text-muted-foreground">{unit}</span>}
          </div>
        ) : (
          <div
            className="flex w-full cursor-text items-center justify-end text-foreground/60 hover:text-foreground transition-colors"
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
