'use client'

import { useScene } from '@pascal-app/core'
import { useCallback, useRef, useState } from 'react'
import NumberFlow from '@number-flow/react'

interface NumberInputProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  precision?: number
  step?: number
  className?: string
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  precision = 2,
  step = 0.1,
  className = '',
}: NumberInputProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [inputValue, setInputValue] = useState(value.toFixed(precision))
  const startXRef = useRef(0)
  const startValueRef = useRef(0)
  const labelRef = useRef<HTMLLabelElement>(null)

  const clamp = useCallback(
    (val: number) => {
      if (min !== undefined && val < min) return min
      if (max !== undefined && val > max) return max
      return val
    },
    [min, max],
  )

  const handleLabelMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return
      e.preventDefault()
      setIsDragging(true)
      startXRef.current = e.clientX
      startValueRef.current = value

      // Pause history tracking during drag
      useScene.temporal.getState().pause()

      let finalValue = value

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startXRef.current

        // Determine step size based on modifier keys
        let dragStep = step // Default from prop
        if (moveEvent.shiftKey) {
          dragStep = step * 10 // Coarse
        } else if (moveEvent.altKey) {
          dragStep = step * 0.1 // Fine
        }

        const deltaValue = deltaX * dragStep
        const newValue = clamp(startValueRef.current + deltaValue)
        const newFinalValue = Number.parseFloat(newValue.toFixed(precision))

        // Only call onChange if value actually changed (avoid extra processing on tiny moves)
        if (newFinalValue !== finalValue) {
          finalValue = newFinalValue
          onChange(finalValue)
        }
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)

        // Reset to initial value while still paused (no history entry)
        // Then resume and apply final value (creates single history entry)
        if (finalValue !== startValueRef.current) {
          onChange(startValueRef.current)
          useScene.temporal.getState().resume()
          onChange(finalValue)
        } else {
          useScene.temporal.getState().resume()
        }
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [isEditing, value, onChange, clamp, precision],
  )

  const handleValueClick = useCallback(() => {
    setIsEditing(true)
    setInputValue(value.toFixed(precision))
  }, [value, precision])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }, [])

  const handleInputBlur = useCallback(() => {
    const numValue = Number.parseFloat(inputValue)
    if (!Number.isNaN(numValue)) {
      onChange(clamp(Number.parseFloat(numValue.toFixed(precision))))
    }
    setIsEditing(false)
  }, [inputValue, onChange, clamp, precision])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const numValue = Number.parseFloat(inputValue)
        if (!Number.isNaN(numValue)) {
          onChange(clamp(Number.parseFloat(numValue.toFixed(precision))))
        }
        setIsEditing(false)
      } else if (e.key === 'Escape') {
        setInputValue(value.toFixed(precision))
        setIsEditing(false)
      }
    },
    [inputValue, onChange, value, clamp, precision],
  )

  return (
    <div className={`${className} relative group/input`}>
      <div 
        className={`absolute inset-y-0 left-0 bg-primary/10 dark:bg-primary/20 pointer-events-none transition-all duration-75 ${isDragging ? 'opacity-100' : 'opacity-0'}`}
        style={{ 
          width: `${Math.min(100, Math.max(0, ((value - (min ?? Math.min(0, value))) / ((max ?? Math.max(10, value)) - (min ?? Math.min(0, value)))) * 100))}%`,
          borderTopRightRadius: value >= (max ?? Math.max(10, value)) ? '0.5rem' : '0',
          borderBottomRightRadius: value >= (max ?? Math.max(10, value)) ? '0.5rem' : '0',
          borderTopLeftRadius: '0.5rem',
          borderBottomLeftRadius: '0.5rem',
        }}
      />
      <div className={`flex items-center rounded-lg border shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] overflow-hidden transition-all focus-within:ring-1 focus-within:ring-primary focus-within:border-primary relative z-10 ${isDragging ? 'bg-transparent border-neutral-300 dark:border-border ring-1 ring-neutral-200/60 dark:ring-border/50' : 'bg-white dark:bg-accent/30 border-neutral-200/60 dark:border-border/50 hover:border-neutral-300 dark:hover:border-border/80'}`}>
        <div
          ref={labelRef}
          className={`pl-2 pr-1 py-1.5 text-muted-foreground text-xs select-none font-medium truncate z-10 ${
            isDragging ? 'cursor-ew-resize text-foreground' : 'hover:cursor-ew-resize hover:text-foreground'
          } transition-colors`}
          onMouseDown={handleLabelMouseDown}
        >
          {label}
        </div>
        {isEditing ? (
          <input
            autoFocus
            size={1}
            className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-foreground text-sm font-medium outline-none text-right placeholder:text-muted-foreground/50 z-10"
            onBlur={handleInputBlur}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            type="text"
            value={inputValue}
          />
        ) : (
          <div
            className={`flex-1 px-2 py-1.5 text-sm font-medium cursor-text hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-right truncate z-10 text-foreground tabular-nums tracking-tight min-w-0`}
            onClick={handleValueClick}
          >
            <NumberFlow
              value={Number(value.toFixed(precision))}
              format={{ minimumFractionDigits: precision, maximumFractionDigits: precision }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
