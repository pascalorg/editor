'use client'

import { type FormatOptions, type LingoOptions, lingo } from '@pascal-app/lingo'
import { parseDate } from '@pascal-app/lingo/date'
import { AlertTriangleIcon, CheckIcon, InfoIcon, SearchIcon, XIcon } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type DisplayResult, resultValueLabel } from '@/lib/lingo-display'
import { cn } from '@/lib/utils'

const CYCLE_DELAY_MS = 4600
const CURSOR_TRAVEL_MS = 680
const CURSOR_TRACK_INTERVAL_MS = 72
const TYPE_START_DELAY_MS = CURSOR_TRAVEL_MS + 140
const TYPE_SETTLE_DELAY_MS = 520
const TYPE_DELAY_BASE_MS = 64
const TYPE_DELAY_STEP_MS = 18
const INPUT_CARET_GUTTER_PX = 7
const FIX_REVEAL_DELAY_MS = 280
// Travel time must match --hero-cursor-duration for [data-state="fix"] in
// globals.css; the extra time is a human-like pause before pressing.
const FIX_CURSOR_TRAVEL_MS = 950
const FIX_CURSOR_SETTLE_DELAY_MS = FIX_CURSOR_TRAVEL_MS + 250
const FIX_PRESS_HOLD_MS = 420
const FIX_HIDE_DELAY_MS = 260
const MIDNIGHT_REFRESH_BUFFER_MS = 1000

type HeroCursorState = 'hidden' | 'travel' | 'typing' | 'fix' | 'clicking'
type HeroStatusTone = 'success' | 'warning' | 'error' | 'info'
type HeroFieldExample = {
  autoFix?: boolean
  className: string
  fixMeta?: string
  id: string
  label: string
  meta: string
  options?: LingoOptions
  outputFormat?: FormatOptions
  outputUnit?: string
  value: string
}

const HERO_STATUS_ICONS = {
  error: XIcon,
  info: InfoIcon,
  success: CheckIcon,
  warning: AlertTriangleIcon,
} as const

const HERO_STATUS_ICON_CLASS = {
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',
} as const

const HERO_FIELDS: readonly HeroFieldExample[] = [
  {
    id: 'height',
    value: '5ft11',
    label: 'Height conversion field',
    meta: 'Height normalized to meters',
    className: 'sm:top-5 sm:left-[6%] sm:w-[15.5rem]',
    options: { kind: 'length' },
    outputFormat: { precision: 2 },
    outputUnit: 'm',
  },
  {
    id: 'size',
    value: '5gig',
    label: 'Attachment size field',
    meta: 'File size slang normalized',
    className: 'sm:top-[8.75rem] sm:left-[36%] sm:w-[12.5rem]',
  },
  {
    id: 'conversion',
    value: '100 km in miles',
    label: 'Unit conversion field',
    meta: 'Explicit conversion to miles',
    className: 'sm:top-2 sm:right-[1%] sm:w-[17rem]',
  },
  {
    id: 'range',
    value: 'under 10 min',
    label: 'Time limit field',
    meta: 'Open-ended duration range',
    className: 'sm:top-[12rem] sm:left-0 sm:w-[16.5rem]',
  },
  {
    id: 'date',
    value: 'noon tomorrow',
    label: 'Reminder field',
    meta: 'Relative date from today',
    className: 'sm:top-[13rem] sm:right-0 sm:w-64',
  },
  {
    id: 'typo',
    value: '5 kilogrms',
    label: 'Package weight field',
    meta: 'Mass normalized to kg',
    fixMeta: 'Typo found: use kg',
    className: 'sm:bottom-4 sm:left-[31%] sm:w-60',
    options: { kind: 'mass', tolerance: { typos: 'suggest' } },
    autoFix: true,
  },
  {
    id: 'percent',
    value: '85pct',
    label: 'Discount field',
    meta: 'Percent shorthand normalized',
    className: 'sm:bottom-3 sm:left-[2%] sm:w-[12rem]',
  },
  {
    id: 'fuzzy',
    value: "it's warm",
    label: 'Thermostat field',
    meta: 'Fuzzy language becomes a range',
    className: 'sm:right-[1%] sm:bottom-2 sm:w-[14.5rem]',
  },
]

let measureCanvas: HTMLCanvasElement | null = null

// getComputedStyle(el).font is empty in Chromium when the font comes from
// longhands (Tailwind + CSS vars), so canvas would fall back to 10px sans-serif
// and mis-measure the caret offset. Rebuild the shorthand from longhands.
function canvasFontFrom(style: CSSStyleDeclaration) {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

function measureTextWidth(text: string, font: string) {
  if (!text || typeof document === 'undefined') {
    return 0
  }

  measureCanvas ??= document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context) {
    return text.length * 8
  }

  context.font = font
  return context.measureText(text).width
}

function optionsFor(text: string): LingoOptions {
  return /\b(hot|cold|warm|freezing)\b/i.test(text) ? { kind: 'temperature' as const } : {}
}

function delayUntilNextLocalDay(now: Date) {
  const nextDay = new Date(now)
  nextDay.setHours(24, 0, 0, MIDNIGHT_REFRESH_BUFFER_MS)
  return nextDay.getTime() - now.getTime()
}

function typingDurationFor(text: string) {
  let duration = 0
  for (let index = 0; index < text.length; index += 1) {
    duration += typingDelayFor(text, index)
  }
  return duration
}

function typingDelayFor(text: string, index: number) {
  const character = text[index] ?? ''
  const previousCharacter = text[index - 1] ?? ''
  const variation = (index % 4) * TYPE_DELAY_STEP_MS

  if (character === ' ') {
    return 140 + variation
  }

  if (/["'.,°]/.test(character)) {
    return 120 + variation
  }

  if (previousCharacter === ' ') {
    return 96 + variation
  }

  return TYPE_DELAY_BASE_MS + variation
}

function parseUniversal(
  text: string,
  options?: LingoOptions,
  dateReferenceNow?: Date | null,
): DisplayResult | null {
  if (!text.trim()) {
    return null
  }

  const parsed = lingo(text, { ...optionsFor(text), ...options })
  if (parsed.ok) {
    return parsed
  }

  if (!dateReferenceNow) {
    return parsed
  }

  const date = parseDate(text, { now: dateReferenceNow, dayFirst: true })
  return date.ok ? date : parsed
}

function resultMetaLabel(
  result: DisplayResult | null,
  example: HeroFieldExample,
  fixValue: string | null,
  currentValue: string,
) {
  if (!result) {
    return 'Waiting for input'
  }

  if (!result.ok) {
    if (fixValue) {
      return example.fixMeta ?? `Fix available: ${fixValue}`
    }

    if (currentValue === example.value) {
      return example.meta
    }

    const suggestion = result.issues[0]?.suggestions?.[0]
    return suggestion ? `Did you mean ${suggestion}?` : 'Needs a clearer value'
  }

  return example.meta
}

function resultPrimaryLabel(
  result: DisplayResult | null,
  outputUnit?: string,
  outputFormat?: FormatOptions,
) {
  if (!result) {
    return 'Waiting'
  }

  if (!result.ok) {
    const suggestion = result.issues[0]?.suggestions?.[0]
    return suggestion ? `Try ${suggestion}` : 'Needs review'
  }

  if (result.type === 'date') {
    return result.date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  if (outputUnit && result.type === 'quantity') {
    return result.quantity.to(outputUnit).format(outputFormat ?? { significant: 5 })
  }

  if (outputUnit && result.type === 'range') {
    return result.range.to(outputUnit).format(outputFormat ?? { significant: 5 })
  }

  return resultValueLabel(result)
}

function resultFixValue(result: DisplayResult | null) {
  if (!result || result.ok || !('candidate' in result) || !result.candidate) {
    return null
  }

  return resultValueLabel(result.candidate)
}

function resultStatusTone(result: DisplayResult | null, typing: boolean): HeroStatusTone {
  if (typing || !result) {
    return 'info'
  }

  if (!result.ok) {
    return 'error'
  }

  if (result.issues.some((issue) => issue.severity === 'warning')) {
    return 'warning'
  }

  if (result.issues.some((issue) => issue.severity === 'info')) {
    return 'info'
  }

  return 'success'
}

function FloatingInputCard({
  active,
  autoFocus,
  dateReferenceNow,
  example,
  reduceMotion,
}: {
  active: boolean
  autoFocus: boolean
  dateReferenceNow: Date | null
  example: HeroFieldExample
  reduceMotion: boolean | null
}) {
  const inputId = useId()
  const descriptionId = useId()
  const [value, setValue] = useState<string>(example.value)
  const [manual, setManual] = useState(false)
  const [typing, setTyping] = useState(false)
  const [fixReady, setFixReady] = useState(false)
  const [autoFixing, setAutoFixing] = useState(false)
  const focusedRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const fixTimerRef = useRef<number | null>(null)
  const animatingRef = useRef(false)

  const stopTyping = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cancelTyping = useCallback(() => {
    stopTyping()
    animatingRef.current = false
    setTyping(false)
  }, [stopTyping])

  const stopFix = useCallback(() => {
    if (fixTimerRef.current !== null) {
      window.clearTimeout(fixTimerRef.current)
      fixTimerRef.current = null
    }
  }, [])

  useEffect(() => stopTyping, [stopTyping])
  useEffect(() => stopFix, [stopFix])

  useEffect(() => {
    if (!active || manual || focusedRef.current) {
      return
    }

    stopTyping()
    stopFix()
    setAutoFixing(false)
    setFixReady(false)

    if (reduceMotion) {
      timerRef.current = window.setTimeout(() => {
        setTyping(false)
        setValue(example.value)
        timerRef.current = null
      }, 0)
      return stopTyping
    }

    timerRef.current = window.setTimeout(() => {
      animatingRef.current = true
      setTyping(true)
      setValue('')
      let index = 0

      const tick = () => {
        index += 1
        setValue(example.value.slice(0, index))

        if (index >= example.value.length) {
          timerRef.current = window.setTimeout(() => {
            animatingRef.current = false
            setTyping(false)
            setFixReady(example.autoFix === true)
            timerRef.current = null
          }, TYPE_SETTLE_DELAY_MS)
          return
        }

        timerRef.current = window.setTimeout(tick, typingDelayFor(example.value, index))
      }

      timerRef.current = window.setTimeout(tick, typingDelayFor(example.value, 0))
    }, TYPE_START_DELAY_MS)

    // Throttled background-tab timers can let the parent cycle deactivate the
    // card mid-animation; settle to the full value so it never sticks on
    // "Typing...". Skipped when the animation already finished, so a manual or
    // auto-fixed value is never clobbered.
    return () => {
      stopTyping()
      if (animatingRef.current) {
        animatingRef.current = false
        setTyping(false)
        setValue(example.value)
      }
    }
  }, [active, example.autoFix, example.value, manual, reduceMotion, stopFix, stopTyping])

  const result = useMemo(
    () => parseUniversal(value, example.options, dateReferenceNow),
    [dateReferenceNow, example.options, value],
  )
  const fixValue = useMemo(() => resultFixValue(result), [result])

  useEffect(() => {
    if (!(active && fixReady && fixValue && !manual && !reduceMotion)) {
      return
    }

    fixTimerRef.current = window.setTimeout(() => {
      fixTimerRef.current = window.setTimeout(() => {
        setAutoFixing(true)

        fixTimerRef.current = window.setTimeout(() => {
          setValue(fixValue)
          setAutoFixing(false)
          setFixReady(false)
          fixTimerRef.current = null
        }, FIX_PRESS_HOLD_MS)
      }, FIX_CURSOR_SETTLE_DELAY_MS)
    }, FIX_REVEAL_DELAY_MS)

    return () => {
      stopFix()
      setAutoFixing(false)
    }
  }, [active, fixReady, fixValue, manual, reduceMotion, stopFix])

  const applyFix = () => {
    if (!fixValue) {
      return
    }

    cancelTyping()
    stopFix()
    setAutoFixing(false)
    setFixReady(false)
    setManual(true)
    setValue(fixValue)
  }

  const output = useMemo(() => {
    if (typing) {
      return {
        meta: 'Reading as you type',
        value: 'Typing...',
      }
    }

    return {
      meta: resultMetaLabel(result, example, fixValue, value),
      value: resultPrimaryLabel(result, example.outputUnit, example.outputFormat),
    }
  }, [example, fixValue, result, typing, value])

  const statusTone = resultStatusTone(result, typing)
  const StatusIcon = HERO_STATUS_ICONS[statusTone]
  const invalid = statusTone === 'error'

  return (
    <article
      className={cn(
        'hero-field-card corner-smooth nested-frame group relative h-[7.5rem] min-w-0 rounded-2xl bg-card p-2 outline-none sm:absolute',
        active ? 'z-20 opacity-100' : 'z-10 opacity-[0.9]',
        example.className,
      )}
      data-active={active ? 'true' : undefined}
      data-hero-field={example.id}
    >
      <label className="sr-only" htmlFor={inputId}>
        {example.label}
      </label>
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground sm:size-4"
        />
        <Input
          aria-describedby={descriptionId}
          aria-invalid={invalid}
          autoFocus={autoFocus}
          className={cn(
            'numeric-mono h-9 rounded-[var(--nested-inset-radius)] border-border bg-muted/35 px-2.5 pl-8 text-sm shadow-none [corner-shape:inherit] hover:bg-muted/45 focus-visible:border-[var(--control-focus-border)] focus-visible:bg-background focus-visible:ring-0 aria-invalid:border-border aria-invalid:ring-0 sm:h-9',
            fixValue && !typing && 'pr-14',
          )}
          data-hero-input={example.id}
          id={inputId}
          onBlur={(event) => {
            focusedRef.current = false
            if (!event.currentTarget.value.trim()) {
              setManual(false)
            }
          }}
          onChange={(event) => {
            cancelTyping()
            stopFix()
            setAutoFixing(false)
            setFixReady(false)
            setManual(true)
            setValue(event.target.value)
          }}
          onFocus={() => {
            focusedRef.current = true
            cancelTyping()
            stopFix()
            setAutoFixing(false)
            setFixReady(false)
          }}
          spellCheck={false}
          value={value}
        />
        {fixValue && !typing ? (
          <Button
            aria-label={`Fix to ${fixValue}`}
            className={cn(
              'hero-fix-button absolute top-1/2 right-1.5 h-6 -translate-y-1/2 border-red-200 bg-red-50 px-2 font-mono text-[0.68rem] text-red-700 leading-none shadow-none hover:bg-red-100 hover:text-red-800 focus-visible:border-red-400 focus-visible:ring-red-200 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300 dark:focus-visible:ring-red-500/30 dark:hover:bg-red-500/25 dark:hover:text-red-200',
              autoFixing &&
                'scale-[0.94] border-red-400 bg-red-100 text-red-800 ring-2 ring-red-300/60 dark:bg-red-500/25 dark:ring-red-500/40',
            )}
            data-auto-fixing={autoFixing ? 'true' : undefined}
            data-hero-fix={example.id}
            onClick={applyFix}
            size="xs"
            type="button"
            variant="outline"
          >
            Fix
          </Button>
        ) : null}
      </div>

      <div
        aria-busy={typing}
        className="hero-output-panel mt-2 h-[3.25rem] px-2.5 py-2"
        data-status={statusTone}
        data-typing={typing ? 'true' : undefined}
      >
        <div className="flex h-5 min-w-0 items-center gap-2">
          <p className="hero-output-value numeric-mono min-w-0 flex-1 truncate font-semibold text-sm tracking-normal sm:text-[0.95rem]">
            {output.value}
          </p>
          <span
            aria-hidden="true"
            className={cn(
              'ml-auto flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]',
              HERO_STATUS_ICON_CLASS[statusTone],
            )}
          >
            <StatusIcon className="size-3" strokeWidth={2.25} />
          </span>
        </div>
        <p
          className="hero-output-meta numeric-mono mt-1 h-4 truncate text-[0.68rem] text-muted-foreground leading-4 tracking-normal"
          id={descriptionId}
        >
          {output.meta}
        </p>
      </div>
    </article>
  )
}

export function UniversalInput({ autoFocus = false }: { autoFocus?: boolean }) {
  const reduceMotion = useReducedMotion()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dateReferenceNow, setDateReferenceNow] = useState<Date | null>(null)

  useEffect(() => {
    let timer: number | null = null

    const updateReference = () => {
      const now = new Date()
      setDateReferenceNow(now)
      timer = window.setTimeout(updateReference, delayUntilNextLocalDay(now))
    }

    updateReference()

    return () => {
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [])

  const positionHeroCursor = useCallback(
    (state: HeroCursorState) => {
      const cursor = cursorRef.current
      if (!cursor) {
        return
      }

      if (state === 'hidden') {
        cursor.dataset.state = 'hidden'
        return
      }

      const surface = surfaceRef.current
      const activeExample = HERO_FIELDS[activeIndex] ?? HERO_FIELDS[0]
      const input = surface?.querySelector<HTMLInputElement>(
        `[data-hero-input="${activeExample.id}"]`,
      )
      const fixButton = surface?.querySelector<HTMLElement>(`[data-hero-fix="${activeExample.id}"]`)

      if (
        !surface ||
        (state === 'typing'
          ? !input
          : state === 'fix' || state === 'clicking'
            ? !fixButton
            : !input)
      ) {
        cursor.dataset.state = 'hidden'
        return
      }

      const surfaceRect = surface.getBoundingClientRect()

      if ((state === 'fix' || state === 'clicking') && fixButton) {
        const fixRect = fixButton.getBoundingClientRect()
        cursor.style.setProperty(
          '--hero-cursor-x',
          `${fixRect.left - surfaceRect.left + fixRect.width / 2}px`,
        )
        cursor.style.setProperty(
          '--hero-cursor-y',
          `${fixRect.top - surfaceRect.top + fixRect.height / 2}px`,
        )
        cursor.dataset.state = state
        return
      }

      if (!input) {
        cursor.dataset.state = 'hidden'
        return
      }

      const inputRect = input.getBoundingClientRect()
      const inputStyle = window.getComputedStyle(input)
      const paddingLeft = Number.parseFloat(inputStyle.paddingLeft) || 0
      const paddingRight = Number.parseFloat(inputStyle.paddingRight) || 0
      const availableTextWidth = Math.max(
        0,
        inputRect.width - paddingLeft - paddingRight - INPUT_CARET_GUTTER_PX,
      )
      const typedTextWidth =
        state === 'typing'
          ? Math.min(measureTextWidth(input.value, canvasFontFrom(inputStyle)), availableTextWidth)
          : 0

      cursor.style.setProperty(
        '--hero-cursor-x',
        `${inputRect.left - surfaceRect.left + paddingLeft + typedTextWidth}px`,
      )
      cursor.style.setProperty(
        '--hero-cursor-y',
        `${inputRect.top - surfaceRect.top + inputRect.height / 2}px`,
      )
      cursor.dataset.state = state
    },
    [activeIndex],
  )

  useEffect(() => {
    if (reduceMotion) {
      return
    }

    const timer = window.setTimeout(() => {
      setActiveIndex((index) => (index + 1) % HERO_FIELDS.length)
    }, CYCLE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [activeIndex, reduceMotion])

  useEffect(() => {
    if (reduceMotion) {
      positionHeroCursor('hidden')
      return
    }

    const activeExample = HERO_FIELDS[activeIndex] ?? HERO_FIELDS[0]
    const frame = window.requestAnimationFrame(() => positionHeroCursor('travel'))
    let trackingTimer: number | null = null
    const typingTimer = window.setTimeout(() => {
      positionHeroCursor('typing')
      trackingTimer = window.setInterval(
        () => positionHeroCursor('typing'),
        CURSOR_TRACK_INTERVAL_MS,
      )
    }, TYPE_START_DELAY_MS + 80)
    const fixAt =
      TYPE_START_DELAY_MS +
      typingDurationFor(activeExample.value) +
      TYPE_SETTLE_DELAY_MS +
      FIX_REVEAL_DELAY_MS
    const fixTimer =
      activeExample.autoFix === true
        ? window.setTimeout(() => {
            // Stop caret tracking or it re-snaps the cursor to the input every
            // tick, cancelling the travel toward the fix button.
            if (trackingTimer !== null) {
              window.clearInterval(trackingTimer)
              trackingTimer = null
            }
            positionHeroCursor('fix')
          }, fixAt)
        : null
    const clickTimer =
      activeExample.autoFix === true
        ? window.setTimeout(
            () => positionHeroCursor('clicking'),
            fixAt + FIX_CURSOR_SETTLE_DELAY_MS,
          )
        : null
    const hideFixTimer =
      activeExample.autoFix === true
        ? window.setTimeout(
            () => positionHeroCursor('hidden'),
            fixAt + FIX_CURSOR_SETTLE_DELAY_MS + FIX_PRESS_HOLD_MS + FIX_HIDE_DELAY_MS,
          )
        : null

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(typingTimer)
      if (fixTimer !== null) {
        window.clearTimeout(fixTimer)
      }
      if (clickTimer !== null) {
        window.clearTimeout(clickTimer)
      }
      if (hideFixTimer !== null) {
        window.clearTimeout(hideFixTimer)
      }
      if (trackingTimer !== null) {
        window.clearInterval(trackingTimer)
      }
    }
  }, [activeIndex, positionHeroCursor, reduceMotion])

  useEffect(() => {
    if (reduceMotion) {
      return
    }

    let frame: number | null = null
    const updateCursor = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }

      frame = window.requestAnimationFrame(() => {
        const state = (cursorRef.current?.dataset.state ?? 'travel') as HeroCursorState
        positionHeroCursor(state === 'hidden' ? 'travel' : state)
        frame = null
      })
    }

    window.addEventListener('resize', updateCursor)
    return () => {
      window.removeEventListener('resize', updateCursor)
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [positionHeroCursor, reduceMotion])

  return (
    <section
      aria-label="Natural-language parser field examples"
      className="relative w-full min-w-0 overflow-visible py-6 sm:-mx-8 sm:px-8 sm:py-8 min-[120rem]:w-[calc(100%+14rem)] min-[96rem]:w-[calc(100%+6rem)]"
      data-landing-demo="hero"
      data-slot="universal-input-surface"
    >
      <div
        className="relative grid grid-cols-1 gap-3 overflow-visible sm:block sm:min-h-[32rem] lg:min-h-[33rem] min-[30rem]:grid-cols-2"
        ref={surfaceRef}
      >
        {HERO_FIELDS.map((example, index) => (
          <FloatingInputCard
            active={index === activeIndex}
            autoFocus={autoFocus && index === 0}
            dateReferenceNow={dateReferenceNow}
            example={example}
            key={example.id}
            reduceMotion={reduceMotion}
          />
        ))}
        <div aria-hidden="true" className="hero-demo-cursor" data-state="hidden" ref={cursorRef}>
          <svg
            className="hero-demo-cursor-pointer"
            fill="none"
            height="24"
            viewBox="0 0 24 24"
            width="24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M20.5056 10.7754C21.1225 10.5355 21.431 10.4155 21.5176 10.2459C21.5926 10.099 21.5903 9.92446 21.5115 9.77954C21.4205 9.61226 21.109 9.50044 20.486 9.2768L4.59629 3.5728C4.0866 3.38983 3.83175 3.29835 3.66514 3.35605C3.52029 3.40621 3.40645 3.52004 3.35629 3.6649C3.29859 3.8315 3.39008 4.08635 3.57304 4.59605L9.277 20.4858C9.50064 21.1088 9.61246 21.4203 9.77973 21.5113C9.92465 21.5901 10.0991 21.5924 10.2461 21.5174C10.4157 21.4308 10.5356 21.1223 10.7756 20.5054L13.3724 13.8278C13.4194 13.707 13.4429 13.6466 13.4792 13.5957C13.5114 13.5506 13.5508 13.5112 13.5959 13.479C13.6468 13.4427 13.7072 13.4192 13.828 13.3722L20.5056 10.7754Z"
              fill="#202022"
              stroke="#D3DAF0"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
            />
          </svg>
          <span className="hero-demo-caret" />
        </div>
      </div>
    </section>
  )
}
