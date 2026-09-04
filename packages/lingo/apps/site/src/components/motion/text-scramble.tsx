'use client'

import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

const DEFAULT_CHARACTER_SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export interface TextScrambleProps {
  characterSet?: string
  children: string
  className?: string
  duration?: number
  onScrambleComplete?: () => void
  speed?: number
  trigger?: boolean
}

export function TextScramble({
  children,
  className,
  trigger = true,
  duration = 0.38,
  speed = 0.05,
  characterSet = DEFAULT_CHARACTER_SET,
  onScrambleComplete,
}: TextScrambleProps) {
  const reduceMotion = useReducedMotion()
  // Store which source text the scramble frames belong to; stale frames
  // self-evict when `children` changes, so no reset-on-prop-change effect.
  const [scramble, setScramble] = useState<{ source: string; text: string } | null>(null)
  const intervalRef = useRef<number | null>(null)
  // Latest-ref for the callback: written post-render (compiler-safe), read
  // inside the interval so the effect never re-runs on handler identity.
  const onCompleteRef = useRef(onScrambleComplete)
  useEffect(() => {
    onCompleteRef.current = onScrambleComplete
  })

  useEffect(() => {
    if (!trigger || reduceMotion) {
      if (trigger && reduceMotion) {
        const frame = window.requestAnimationFrame(() => onCompleteRef.current?.())
        return () => window.cancelAnimationFrame(frame)
      }
      return
    }

    const steps = Math.max(1, Math.round(duration / speed))
    let step = 0

    intervalRef.current = window.setInterval(() => {
      const progress = step / steps
      let next = ''

      for (let index = 0; index < children.length; index += 1) {
        const char = children[index]
        if (char === ' ') {
          next += char
          continue
        }
        next +=
          progress * children.length > index
            ? char
            : characterSet[Math.floor(Math.random() * characterSet.length)]
      }

      setScramble({ source: children, text: next })
      step += 1

      if (step > steps) {
        if (intervalRef.current !== null) {
          window.clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        setScramble(null)
        onCompleteRef.current?.()
      }
    }, speed * 1000)

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [characterSet, children, duration, reduceMotion, speed, trigger])

  const display = scramble?.source === children ? scramble.text : children

  return (
    <span className={className}>
      <span className="sr-only">{children}</span>
      <span aria-hidden="true" className={cn('inline-block', className)}>
        {display}
      </span>
    </span>
  )
}
