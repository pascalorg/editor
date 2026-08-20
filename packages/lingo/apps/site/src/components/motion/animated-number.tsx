'use client'

import { m, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect, useMemo } from 'react'

import { cn } from '@/lib/utils'

export type AnimatedNumberFormat = Intl.NumberFormatOptions | ((value: number) => string)

export interface AnimatedNumberProps {
  className?: string
  format?: AnimatedNumberFormat
  value: number
}

const SPRING = {
  stiffness: 420,
  damping: 36,
  mass: 0.7,
}

function decimalPlacesFromFormatted(text: string) {
  const match = text.match(/[-+]?\d+(?:[.,](\d+))?/)
  return match?.[1]?.length ?? 0
}

function clampToPrecision(value: number, decimalPlaces: number) {
  if (!Number.isFinite(value)) {
    return value
  }
  const places = Math.max(0, Math.min(20, decimalPlaces))
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export function AnimatedNumber({ value, format, className }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion()
  const source = useMotionValue(value)
  const spring = useSpring(source, SPRING)
  const formatter = useMemo(() => {
    if (typeof format === 'function') {
      return {
        formatValue: format,
        decimalPlaces: decimalPlacesFromFormatted(format(value)),
      }
    }

    const intl = new Intl.NumberFormat('en', format)
    return {
      formatValue: (next: number) => intl.format(next),
      decimalPlaces:
        intl.formatToParts(value).find((part) => part.type === 'fraction')?.value.length ?? 0,
    }
  }, [format, value])
  const finalText = formatter.formatValue(value)
  const animatedText = useTransform(spring, (latest) =>
    formatter.formatValue(clampToPrecision(latest, formatter.decimalPlaces)),
  )

  useEffect(() => {
    source.set(value)
  }, [source, value])

  if (reduceMotion) {
    return (
      <span className={cn('inline-flex tabular-nums', className)}>
        <span className="sr-only">{finalText}</span>
        <span aria-hidden="true">{finalText}</span>
      </span>
    )
  }

  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      <span className="sr-only">{finalText}</span>
      <m.span aria-hidden="true">{animatedText}</m.span>
    </span>
  )
}
