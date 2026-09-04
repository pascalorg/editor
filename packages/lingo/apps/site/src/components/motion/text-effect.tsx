'use client'

import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type TextEffectMode = 'char' | 'word' | 'line'
type TextEffectPreset = 'blur' | 'fade-in-blur' | 'scale' | 'fade' | 'slide'

const EASE_OUT = [0.16, 1, 0.3, 1] as const
const DEFAULT_STAGGER: Record<TextEffectMode, number> = {
  char: 0.015,
  word: 0.05,
  line: 0.15,
}

const PRESET_VARIANTS = {
  blur: {
    hidden: { opacity: 0, filter: 'blur(8px)' },
    visible: { opacity: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, filter: 'blur(8px)' },
  },
  'fade-in-blur': {
    hidden: { opacity: 0, y: 4, filter: 'blur(6px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -3, filter: 'blur(6px)' },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.96 },
    visible: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
  },
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
  },
  slide: {
    hidden: { opacity: 0, y: 6 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  },
}

export interface TextEffectProps {
  children: string
  className?: string
  delay?: number
  onAnimationComplete?: () => void
  per?: TextEffectMode
  preset?: TextEffectPreset
  segmentClassName?: string
  segmentDuration?: number
  segmentWrapperClassName?: string
  stagger?: number
  trigger?: boolean
  triggerKey?: string | number
}

function splitText(text: string, per: TextEffectMode) {
  if (per === 'line') {
    return text.split('\n')
  }
  return text.split(/(\s+)/)
}

function SegmentWrapper({
  children,
  className,
  per,
}: {
  children: ReactNode
  className?: string
  per: TextEffectMode
}) {
  if (!className) {
    return <>{children}</>
  }

  return (
    <span className={cn(per === 'line' ? 'block' : 'inline-block', className)}>{children}</span>
  )
}

export function TextEffect({
  children,
  className,
  segmentClassName,
  segmentWrapperClassName,
  per = 'word',
  preset = 'fade-in-blur',
  trigger = true,
  triggerKey,
  delay = 0,
  stagger,
  segmentDuration = 0.15,
  onAnimationComplete,
}: TextEffectProps) {
  const reduceMotion = useReducedMotion()

  if (!trigger) {
    return null
  }

  if (reduceMotion) {
    return <span className={className}>{children}</span>
  }

  const segments = splitText(children, per)
  const itemVariants = PRESET_VARIANTS[preset]
  const staggerChildren = stagger ?? DEFAULT_STAGGER[per]
  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        delayChildren: delay,
        staggerChildren,
      },
    },
    exit: {
      transition: {
        staggerChildren,
        staggerDirection: -1,
      },
    },
  }
  const segmentTransition = {
    duration: segmentDuration,
    ease: EASE_OUT,
  }

  return (
    <AnimatePresence mode="popLayout">
      <m.span
        animate="visible"
        className={cn(per === 'line' ? 'block' : 'inline', className)}
        exit="exit"
        initial="hidden"
        key={`${triggerKey ?? 'text'}:${children}`}
        onAnimationComplete={onAnimationComplete}
        variants={containerVariants}
      >
        {per === 'line' ? null : <span className="sr-only">{children}</span>}
        {per === 'char'
          ? segments.map((segment, segmentIndex) => (
              <SegmentWrapper
                className={segmentWrapperClassName}
                key={`${segment}:${segmentIndex}`}
                per={per}
              >
                <span aria-hidden="true" className="inline-block whitespace-pre">
                  {segment.split('').map((char, charIndex) => (
                    <m.span
                      className={cn('inline-block whitespace-pre', segmentClassName)}
                      key={`${segmentIndex}:${charIndex}:${char}`}
                      transition={segmentTransition}
                      variants={itemVariants}
                    >
                      {char}
                    </m.span>
                  ))}
                </span>
              </SegmentWrapper>
            ))
          : segments.map((segment, index) => (
              <SegmentWrapper
                className={segmentWrapperClassName}
                key={`${segment}:${index}`}
                per={per}
              >
                <m.span
                  aria-hidden={per === 'word' ? 'true' : undefined}
                  className={cn(
                    per === 'line' ? 'block' : 'inline-block whitespace-pre',
                    segmentClassName,
                  )}
                  transition={segmentTransition}
                  variants={itemVariants}
                >
                  {segment}
                </m.span>
              </SegmentWrapper>
            ))}
      </m.span>
    </AnimatePresence>
  )
}
