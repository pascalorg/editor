'use client'

import type { MotionValue } from 'motion/react'
import { m, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import * as React from 'react'

import { cn } from '@/lib/utils'

const SPRING_GLIDE = { stiffness: 700, damping: 50, mass: 0.5 }
const SPRING_BOUNCY = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 14,
  mass: 0.7,
}

type RangeValue = readonly [number, number]

function decimalsFor(step: number) {
  const text = String(step)
  const decimal = text.indexOf('.')
  return decimal === -1 ? 0 : text.length - decimal - 1
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function snapToStep(value: number, min: number, max: number, step: number) {
  const decimals = decimalsFor(step)
  const snapped = Math.round((value - min) / step) * step + min
  return Number(clamp(snapped, min, max).toFixed(decimals))
}

function normalizeRange(
  value: RangeValue,
  min: number,
  max: number,
  step: number,
): [number, number] {
  const first = snapToStep(value[0], min, max, step)
  const second = snapToStep(value[1], min, max, step)
  return first <= second ? [first, second] : [second, first]
}

function valueToPercent(value: number, min: number, max: number) {
  if (max <= min) {
    return 0
  }
  return ((value - min) / (max - min)) * 100
}

function percentToValue(percent: number, min: number, max: number) {
  return min + (percent / 100) * (max - min)
}

function useControllableRange({
  value,
  defaultValue,
  min,
  max,
  step,
  onValueChange,
}: {
  value?: RangeValue
  defaultValue?: RangeValue
  min: number
  max: number
  step: number
  onValueChange?: (value: [number, number]) => void
}) {
  const [internal, setInternal] = React.useState<[number, number]>(() =>
    normalizeRange(defaultValue ?? [min, max], min, max, step),
  )
  const current = normalizeRange(value ?? internal, min, max, step)

  const setValue = React.useCallback(
    (next: [number, number]) => {
      const normalized = normalizeRange(next, min, max, step)
      if (value === undefined) {
        setInternal(normalized)
      }
      onValueChange?.(normalized)
    },
    [max, min, onValueChange, step, value],
  )

  return [current, setValue] as const
}

function SliderThumb({
  thumb,
  position,
  valueNow,
  values,
  ariaMin,
  ariaMax,
  disabled,
  active,
  reduceMotion,
  ariaLabelledBy,
  getAriaValueText,
  onPointerDown,
  onKeyDown,
}: {
  thumb: 0 | 1
  position: MotionValue<number>
  valueNow: number
  values: [number, number]
  ariaMin: number
  ariaMax: number
  disabled: boolean
  active: boolean
  reduceMotion: boolean | null
  ariaLabelledBy?: string
  getAriaValueText?: (value: number, thumb: 0 | 1, values: [number, number]) => string
  onPointerDown: (thumb: 0 | 1, event: React.PointerEvent) => void
  onKeyDown: (thumb: 0 | 1, event: React.KeyboardEvent) => void
}) {
  const left = useTransform(position, (percent) => `${percent}%`)
  const valueText = getAriaValueText?.(valueNow, thumb, values) ?? String(valueNow)

  return (
    <m.div
      aria-disabled={disabled || undefined}
      aria-labelledby={ariaLabelledBy}
      aria-valuemax={ariaMax}
      aria-valuemin={ariaMin}
      aria-valuenow={valueNow}
      aria-valuetext={valueText}
      className="absolute top-1/2 z-10 grid h-11 w-11 cursor-grab place-items-center rounded-md outline-none focus-visible:ring-4 focus-visible:ring-[var(--slider-thumb-focus-ring)] active:cursor-grabbing"
      data-slot="slider-thumb"
      data-thumb={thumb === 0 ? 'min' : 'max'}
      onKeyDown={(event) => onKeyDown(thumb, event)}
      onPointerDown={(event) => {
        event.stopPropagation()
        onPointerDown(thumb, event)
      }}
      role="slider"
      style={{
        left,
        x: '-50%',
        y: '-50%',
        zIndex: active ? 20 : 10 + thumb,
      }}
      tabIndex={disabled ? -1 : 0}
    >
      <m.span
        animate={!reduceMotion && active ? { scale: 1.16 } : { scale: 1 }}
        aria-hidden="true"
        className="block size-4 rounded-full bg-[var(--slider-thumb-background)] shadow-[var(--slider-thumb-shadow)]"
        transition={SPRING_BOUNCY}
      />
    </m.div>
  )
}

export function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  onValueChange,
  getAriaValueText,
  ariaLabel,
  ariaLabelledBy,
  ...props
}: Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> & {
  value?: RangeValue
  defaultValue?: RangeValue
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onValueChange?: (value: [number, number]) => void
  getAriaValueText?: (value: number, thumb: 0 | 1, values: [number, number]) => string
  ariaLabel?: readonly [string, string]
  ariaLabelledBy?: string
}) {
  const baseId = React.useId()
  const reduceMotion = useReducedMotion()
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const activePointerRef = React.useRef<{ id: number; thumb: 0 | 1 } | null>(null)
  const [activeThumb, setActiveThumb] = React.useState<0 | 1 | null>(null)
  const [values, setValues] = useControllableRange({
    value,
    defaultValue,
    min,
    max,
    step,
    onValueChange,
  })

  const lowTarget = useMotionValue(valueToPercent(values[0], min, max))
  const highTarget = useMotionValue(valueToPercent(values[1], min, max))
  const lowSpring = useSpring(lowTarget, SPRING_GLIDE)
  const highSpring = useSpring(highTarget, SPRING_GLIDE)
  const lowPosition = reduceMotion ? lowTarget : lowSpring
  const highPosition = reduceMotion ? highTarget : highSpring
  const fillLeft = useTransform(lowPosition, (percent) => `${percent}%`)
  const fillRight = useTransform(highPosition, (percent) => `${100 - percent}%`)

  React.useEffect(() => {
    lowTarget.set(valueToPercent(values[0], min, max))
    highTarget.set(valueToPercent(values[1], min, max))
  }, [highTarget, lowTarget, max, min, values])

  const updateThumb = React.useCallback(
    (thumb: 0 | 1, nextValue: number) => {
      const lowerBound = thumb === 0 ? min : values[0]
      const upperBound = thumb === 0 ? values[1] : max
      const next = snapToStep(nextValue, lowerBound, upperBound, step)
      setValues(thumb === 0 ? [next, values[1]] : [values[0], next])
    },
    [max, min, setValues, step, values],
  )

  const updateFromClientX = React.useCallback(
    (thumb: 0 | 1, clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0) {
        return
      }
      const percent = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100)
      updateThumb(thumb, percentToValue(percent, min, max))
    },
    [max, min, updateThumb],
  )

  function nearestThumb(clientX: number): 0 | 1 {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) {
      return 0
    }
    const percent = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100)
    const low = valueToPercent(values[0], min, max)
    const high = valueToPercent(values[1], min, max)
    return Math.abs(percent - low) <= Math.abs(percent - high) ? 0 : 1
  }

  function startPointer(thumb: 0 | 1, event: React.PointerEvent) {
    if (disabled || event.button !== 0) {
      return
    }
    event.preventDefault()
    activePointerRef.current = { id: event.pointerId, thumb }
    setActiveThumb(thumb)
    trackRef.current?.setPointerCapture(event.pointerId)
    updateFromClientX(thumb, event.clientX)
  }

  function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    startPointer(nearestThumb(event.clientX), event)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const active = activePointerRef.current
    if (!active || active.id !== event.pointerId) {
      return
    }
    updateFromClientX(active.thumb, event.clientX)
  }

  function endPointer(event: React.PointerEvent<HTMLDivElement>) {
    const active = activePointerRef.current
    if (!active || active.id !== event.pointerId) {
      return
    }
    activePointerRef.current = null
    setActiveThumb(null)
    if (trackRef.current?.hasPointerCapture(event.pointerId)) {
      trackRef.current.releasePointerCapture(event.pointerId)
    }
  }

  function handleKeyDown(thumb: 0 | 1, event: React.KeyboardEvent) {
    if (disabled) {
      return
    }

    const multiplier = event.shiftKey ? 10 : 1
    const delta = step * multiplier
    const current = values[thumb]
    let next: number | null = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next = current + delta
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next = current - delta
    } else if (event.key === 'Home') {
      next = thumb === 0 ? min : values[0]
    } else if (event.key === 'End') {
      next = thumb === 0 ? values[1] : max
    }

    if (next === null) {
      return
    }

    event.preventDefault()
    updateThumb(thumb, next)
  }

  const percents = [
    valueToPercent(values[0], min, max),
    valueToPercent(values[1], min, max),
  ] as const
  const thumbLabelIds = [`${baseId}-min`, `${baseId}-max`] as const

  return (
    <div
      className={cn('w-full', className)}
      data-disabled={disabled || undefined}
      data-slot="slider"
      {...props}
    >
      <div
        className={cn(
          'relative h-11 w-full touch-none select-none rounded-xl',
          disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer',
        )}
        onPointerCancel={endPointer}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        ref={trackRef}
      >
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--slider-track-background)]"
          data-slot="slider-track"
        />
        <m.div
          aria-hidden="true"
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--slider-range-background)]"
          data-slot="slider-range"
          style={{ left: fillLeft, right: fillRight }}
        />
        <SliderThumb
          active={activeThumb === 0}
          ariaLabelledBy={[ariaLabelledBy, thumbLabelIds[0]].filter(Boolean).join(' ')}
          ariaMax={values[1]}
          ariaMin={min}
          disabled={disabled}
          getAriaValueText={getAriaValueText}
          onKeyDown={handleKeyDown}
          onPointerDown={startPointer}
          position={lowPosition}
          reduceMotion={reduceMotion}
          thumb={0}
          valueNow={values[0]}
          values={values}
        />
        <SliderThumb
          active={activeThumb === 1}
          ariaLabelledBy={[ariaLabelledBy, thumbLabelIds[1]].filter(Boolean).join(' ')}
          ariaMax={max}
          ariaMin={values[0]}
          disabled={disabled}
          getAriaValueText={getAriaValueText}
          onKeyDown={handleKeyDown}
          onPointerDown={startPointer}
          position={highPosition}
          reduceMotion={reduceMotion}
          thumb={1}
          valueNow={values[1]}
          values={values}
        />
      </div>
      <span className="sr-only" id={thumbLabelIds[0]}>
        {ariaLabel?.[0] ?? 'Minimum'}
      </span>
      <span className="sr-only" id={thumbLabelIds[1]}>
        {ariaLabel?.[1] ?? 'Maximum'}
      </span>
      <span className="sr-only">
        Current range {percents[0].toFixed(0)} to {percents[1].toFixed(0)} percent
      </span>
    </div>
  )
}
