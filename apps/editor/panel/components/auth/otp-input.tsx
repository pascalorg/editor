'use client'

import { cn } from '@panel/lib/cn'
import { useBreakpoint } from '@panel/lib/hooks/use-breakpoint'
import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef } from 'react'

/**
 * Six-cell OTP entry with the three ergonomics the design calls out by name:
 * paste all six digits into any cell, auto-advance while typing, and Backspace
 * on an empty cell steps back instead of doing nothing.
 *
 * `min-width: 0` on the cells is load-bearing — an <input>'s intrinsic minimum
 * width pushed the six cells outside the card without it.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  invalid = false,
  autoFocus = true,
}: {
  value: string[]
  onChange: (next: string[]) => void
  onComplete?: (code: string) => void
  invalid?: boolean
  autoFocus?: boolean
}) {
  const { touch } = useBreakpoint()
  const refs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const commit = (next: string[]) => {
    onChange(next)
    const joined = next.join('')
    if (joined.length === 6 && onComplete) onComplete(joined)
  }

  const setCell = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1)
    const next = [...value]
    next[index] = digit
    commit(next)
    if (digit && index < 5) refs.current[index + 1]?.focus()
  }

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !value[index] && index > 0) {
      event.preventDefault()
      const next = [...value]
      next[index - 1] = ''
      onChange(next)
      refs.current[index - 1]?.focus()
      return
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      refs.current[index - 1]?.focus()
    }
    if (event.key === 'ArrowRight' && index < 5) {
      event.preventDefault()
      refs.current[index + 1]?.focus()
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!digits) return
    event.preventDefault()
    const next = Array.from({ length: 6 }, (_, i) => digits[i] ?? '')
    commit(next)
    refs.current[Math.min(digits.length, 5)]?.focus()
  }

  return (
    <div className="flex gap-[7px]">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          aria-label={`Digit ${index + 1} of 6`}
          value={value[index] ?? ''}
          onChange={(e) => setCell(index, e.target.value)}
          onKeyDown={(e) => onKeyDown(index, e)}
          onPaste={onPaste}
          className={cn(
            'w-0 min-w-0 flex-1 rounded-[8px] bg-field text-center font-mono text-[18px] font-medium text-fg outline-none',
            'border focus:shadow-[0_0_0_3px_var(--dt-hover)]',
            invalid ? 'border-destructive' : 'border-input focus:border-ring',
            touch ? 'h-[54px]' : 'h-[46px]',
          )}
        />
      ))}
    </div>
  )
}
