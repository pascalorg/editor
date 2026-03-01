'use client'

import { useScene } from '@pascal-app/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

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
  min = -Infinity,
  max = Infinity,
  precision = 2,
  step = 1,
  className,
  unit = '',
}: MetricControlProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [inputValue, setInputValue] = useState(value.toFixed(precision))
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
      
      setIsDragging(true)
      startXRef.current = e.clientX
      startValueRef.current = value
      useScene.temporal.getState().pause()
      
      let finalValue = value

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startXRef.current
        
        let dragStep = step
        if (moveEvent.shiftKey) dragStep = step * 10
        else if (moveEvent.altKey) dragStep = step * 0.1

        const deltaValue = deltaX * dragStep
        const newValue = clamp(startValueRef.current + deltaValue)
        const newFinalValue = Number.parseFloat(newValue.toFixed(precision))

        if (newFinalValue !== finalValue) {
          finalValue = newFinalValue
          onChange(finalValue)
        }
      }

      const handlePointerUp = () => {
        setIsDragging(false)
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
        
        if (finalValue !== startValueRef.current) {
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
    [isEditing, value, onChange, clamp, precision, step]
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

  return (
    <div 
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn("group flex h-10 w-full items-center justify-between rounded-lg border border-border/50 px-3 text-sm transition-colors", isDragging ? "bg-[#3e3e3e]" : "bg-[#2C2C2E] hover:bg-[#3e3e3e]", className)}
    >
      <div 
        className={cn(
          "text-muted-foreground select-none truncate transition-colors",
          isDragging ? "cursor-ew-resize text-foreground" : "hover:text-foreground hover:cursor-ew-resize"
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
            className="flex w-full cursor-text items-center justify-end text-foreground hover:text-primary transition-colors"
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
