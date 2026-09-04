'use client'

import { CheckIcon, ClipboardIcon } from 'lucide-react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const COPY_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

type CopyIconMorphProps = {
  copied: boolean
  dataIcon?: 'inline-start' | 'inline-end'
}

export function CopyIconMorph({ copied, dataIcon }: CopyIconMorphProps) {
  const reduceMotion = useReducedMotion()
  const initial = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, filter: 'blur(2px)', x: -3, scale: 0.94 }
  const animate = reduceMotion
    ? { opacity: 1 }
    : { opacity: 1, filter: 'blur(0px)', x: 0, scale: 1 }
  const exit = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, filter: 'blur(2px)', x: 3, scale: 0.94 }

  return (
    <span
      className="relative inline-grid place-items-center"
      data-icon={dataIcon}
      data-slot="button-icon"
    >
      <AnimatePresence initial={false}>
        <m.span
          animate={animate}
          className="absolute inset-0"
          exit={exit}
          initial={initial}
          key={copied ? 'check' : 'copy'}
          transition={{ duration: 0.15, ease: COPY_EASE }}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <ClipboardIcon aria-hidden="true" />}
        </m.span>
      </AnimatePresence>
    </span>
  )
}

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  title,
  className,
}: {
  text: string
  label?: string
  copiedLabel?: string
  title?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    },
    [],
  )

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      aria-label={copied ? copiedLabel : label}
      className={cn('size-8', className)}
      onClick={handleCopy}
      size="icon"
      title={title ?? (copied ? copiedLabel : label)}
      type="button"
      variant="ghost"
    >
      <CopyIconMorph copied={copied} />
    </Button>
  )
}
