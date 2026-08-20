'use client'

import { useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

type ViewMargin = `${number}px ${number}px ${number}% ${number}px`

export function useViewReveal<T extends Element>({
  amount = 0.05,
  margin = '0px 0px -10% 0px',
  disabled = false,
  fallbackMs = 650,
}: {
  amount?: number | 'some' | 'all'
  margin?: ViewMargin
  disabled?: boolean
  fallbackMs?: number
} = {}) {
  const ref = useRef<T | null>(null)
  const inView = useInView(ref, { once: true, amount, margin })
  const [fallbackVisible, setFallbackVisible] = useState(disabled)

  useEffect(() => {
    // `revealed` already derives from disabled/inView directly. The timer is
    // only a fallback for observers that never fire; no sync setState needed.
    if (disabled || inView) {
      return
    }

    const timeout = window.setTimeout(() => setFallbackVisible(true), fallbackMs)
    return () => window.clearTimeout(timeout)
  }, [disabled, fallbackMs, inView])

  return {
    ref,
    revealed: disabled || inView || fallbackVisible,
  } as const
}
