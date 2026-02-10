'use client'

import { useScene } from '@pascal-app/core'
import { useCallback, useRef, useState } from 'react'

interface NumberInputProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  precision?: number
  className?: string
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  precision = 2,
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
        let step = 0.1 // Default
        if (moveEvent.shiftKey) {
          step = 1.0 // Coarse
        } else if (moveEvent.altKey) {
          step = 0.01 // Fine
        }

        const deltaValue = deltaX * step
        const newValue = clamp(startValueRef.current + deltaValue)
        finalValue = Number.parseFloat(newValue.toFixed(precision))
        onChange(finalValue)
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)

        // Resume history tracking and commit final value
        useScene.temporal.getState().resume()
        onChange(finalValue)
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
    <div className={`${className}`}>
      <div className="flex items-center rounded border border-input bg-muted/30 overflow-hidden">
        <label
          ref={labelRef}
          className={`px-2 py-1 text-muted-foreground text-xs select-none ${
            isDragging ? 'cursor-ew-resize' : 'hover:cursor-ew-resize hover:text-foreground'
          } transition-colors`}
          onMouseDown={handleLabelMouseDown}
        >
          {label}
        </label>
        {isEditing ? (
          <input
            autoFocus
            className="flex-1 bg-transparent px-2 py-1 text-foreground text-sm outline-none text-right"
            onBlur={handleInputBlur}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            type="text"
            value={inputValue}
          />
        ) : (
          <div
            className="flex-1 px-2 py-1 text-foreground text-sm cursor-text hover:bg-muted/50 transition-colors text-right"
            onClick={handleValueClick}
          >
            {value.toFixed(precision)}
          </div>
        )}
      </div>
    </div>
  )
}
