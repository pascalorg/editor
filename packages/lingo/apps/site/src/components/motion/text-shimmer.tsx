'use client'

import { m, useReducedMotion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface TextShimmerProps {
  children: string
  className?: string
  duration?: number
  spread?: number
}

export function TextShimmer({
  children,
  className,
  duration = 1.52,
  spread = 2,
}: TextShimmerProps) {
  const reduceMotion = useReducedMotion()
  const dynamicSpread = Math.max(12, children.length * spread)

  if (reduceMotion) {
    return <span className={className}>{children}</span>
  }

  return (
    <m.span
      animate={{ backgroundPosition: '0% center' }}
      className={cn(
        'inline-block bg-clip-text text-transparent [background-size:250%_100%,auto]',
        className,
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          '--base-color': 'color-mix(in oklch, var(--muted-foreground), transparent 8%)',
          '--base-gradient-color': 'var(--foreground)',
          backgroundImage:
            'linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--base-gradient-color), transparent calc(50% + var(--spread))), linear-gradient(var(--base-color), var(--base-color))',
        } as CSSProperties
      }
      transition={{ repeat: Number.POSITIVE_INFINITY, duration, ease: 'linear' }}
    >
      {children as ReactNode}
    </m.span>
  )
}
