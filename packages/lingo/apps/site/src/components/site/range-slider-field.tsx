'use client'

import { parseRange } from '@pascal-app/lingo'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { AnimatedNumber } from '@/components/motion/animated-number'
import { TextEffect } from '@/components/motion/text-effect'
import { DocsPane, DocsSplitPane } from '@/components/site/docs-split-pane'
import { JsonView } from '@/components/site/json-view'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

const MIN = 0
const MAX = 30
const STEP = 0.1
const RANGE_INTEGER_FORMATTER = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})
const RANGE_DECIMAL_FORMATTER = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

function clamp(value: number) {
  return Math.min(MAX, Math.max(MIN, value))
}

function snap(value: number) {
  return Number((Math.round(value / STEP) * STEP).toFixed(1))
}

function normalize(values: [number, number]): [number, number] {
  const next = [snap(clamp(values[0])), snap(clamp(values[1]))] as [number, number]
  return next[0] <= next[1] ? next : [next[1], next[0]]
}

function formatNumber(value: number) {
  return (value % 1 === 0 ? RANGE_INTEGER_FORMATTER : RANGE_DECIMAL_FORMATTER).format(value)
}

function formatKg(value: number) {
  return `${formatNumber(value)} kg`
}

function formatRange(values: [number, number]) {
  return values[0] === values[1]
    ? formatKg(values[0])
    : `${formatNumber(values[0])} to ${formatNumber(values[1])} kg`
}

function SelectedRangeValue({ values }: { values: [number, number] }) {
  if (values[0] === values[1]) {
    return (
      <>
        <AnimatedNumber format={formatNumber} value={values[0]} /> kg
      </>
    )
  }

  return (
    <>
      <AnimatedNumber format={formatNumber} value={values[0]} /> to{' '}
      <AnimatedNumber format={formatNumber} value={values[1]} /> kg
    </>
  )
}

function valuesFromText(text: string): [number, number] | null {
  const result = parseRange(text, { kind: 'mass', unit: 'kg' })
  if (!result.ok) {
    return null
  }

  // Defense in depth for injected or stale parser copies: never convert a
  // cross-kind range into kg even if parseRange ever returns one as ok.
  if (result.range.kind !== 'mass') {
    return null
  }
  const kg = result.range.to('kg')
  const min = kg.min()?.value
  const max = kg.max()?.value
  if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max)) {
    return null
  }

  return normalize([min ?? MIN, max ?? MIN])
}

export function RangeSliderField({
  variant = 'full',
  className,
  textValue,
  onTextValueChange,
  onUserInteraction,
  replayKey = 0,
  replaying = false,
}: {
  variant?: 'full' | 'mini'
  className?: string
  textValue?: string
  onTextValueChange?: (value: string) => void
  onUserInteraction?: () => string | null | void
  replayKey?: number
  replaying?: boolean
}) {
  const id = useId()
  const labelId = `${id}-label`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const [internalText, setInternalText] = useState('8 to 12 kg')
  // Text is the source of truth. Slider interaction anchors an override keyed
  // to the text that produced it, so a stale anchor self-evicts when the user
  // types. No text-to-state sync effect needed.
  const [anchor, setAnchor] = useState<{ forText: string; values: [number, number] }>({
    forText: '8 to 12 kg',
    values: [8, 12],
  })
  // Focus only gates handler behavior (never rendered). A ref avoids a
  // re-render per focus/blur (react-doctor/rerender-state-only-in-handlers).
  const focusedRef = useRef(false)
  const [commitAttempt, setCommitAttempt] = useState(0)
  const [shake, setShake] = useState(false)

  const text = textValue ?? internalText
  const result = useMemo(() => parseRange(text, { kind: 'mass', unit: 'kg' }), [text])
  const committedError = commitAttempt > 0 && !result.ok
  const parsedValues = useMemo(() => valuesFromText(text), [text])
  const values = anchor.forText === text ? anchor.values : (parsedValues ?? anchor.values)
  const mirror = formatRange(values)
  const configJson = useMemo(
    () =>
      JSON.stringify(
        {
          text,
          parser: { kind: 'mass', unit: 'kg' },
          slider: { min: MIN, max: MAX, step: STEP, value: values },
          display: mirror,
        },
        null,
        2,
      ),
    [mirror, text, values],
  )

  function setText(next: string) {
    if (textValue === undefined) {
      setInternalText(next)
    }
    onTextValueChange?.(next)
  }

  const shakeFrameRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (shakeFrameRef.current !== null) {
        window.cancelAnimationFrame(shakeFrameRef.current)
      }
    },
    [],
  )

  // Shake is a commit-time pulse, not derived state: reset then re-set on the
  // next frame so the CSS animation restarts on every failed attempt.
  function pulseShake() {
    setShake(false)
    if (shakeFrameRef.current !== null) {
      window.cancelAnimationFrame(shakeFrameRef.current)
    }
    shakeFrameRef.current = window.requestAnimationFrame(() => {
      shakeFrameRef.current = null
      setShake(true)
    })
  }

  function commit({ rewrite }: { rewrite: boolean }) {
    if (!result.ok) {
      setCommitAttempt((count) => count + 1)
      pulseShake()
      return
    }
    setShake(false)
    const parsed = valuesFromText(text)
    if (!parsed) {
      return
    }
    const nextText = rewrite && !focusedRef.current ? formatRange(parsed) : text
    setAnchor({ forText: nextText, values: parsed })
    if (rewrite && !focusedRef.current) {
      setText(nextText)
    }
  }

  function handleSliderChange(next: [number, number]) {
    const normalized = normalize(next)
    const nextText = focusedRef.current ? text : formatRange(normalized)
    setAnchor({ forText: nextText, values: normalized })
    if (!focusedRef.current) {
      setText(nextText)
    }
  }

  function settleInput(element: HTMLInputElement) {
    const settled = onUserInteraction?.()
    if (typeof settled === 'string') {
      element.value = settled
    }
    return settled
  }

  const controls = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={id} id={labelId}>
          Target parcel weight
        </Label>
        <Input
          aria-describedby={`${hintId} ${errorId}`}
          aria-invalid={committedError}
          className={cn(
            'parse-input h-11 rounded-[6px] font-mono text-base',
            variant === 'mini' && 'h-9 border-border/70 bg-background/45 text-sm shadow-none',
            variant === 'mini' && replaying && 'text-transparent',
          )}
          data-parse-shake={shake}
          data-parse-state={committedError ? 'error' : result.ok ? 'success' : 'idle'}
          id={id}
          onBlur={() => {
            focusedRef.current = false
            const parsed = valuesFromText(text)
            if (parsed) {
              const nextText = formatRange(parsed)
              setAnchor({ forText: nextText, values: parsed })
              setText(nextText)
            } else {
              setCommitAttempt((count) => count + 1)
              pulseShake()
            }
          }}
          onChange={(event) => {
            onUserInteraction?.()
            setText(event.target.value)
          }}
          onFocus={(event) => {
            settleInput(event.currentTarget)
            focusedRef.current = true
          }}
          onKeyDown={(event) => {
            const settled = settleInput(event.currentTarget)
            if (event.key === 'Enter') {
              if (typeof settled === 'string') {
                const parsed = valuesFromText(settled)
                if (parsed) {
                  setAnchor({ forText: settled, values: parsed })
                } else {
                  setCommitAttempt((count) => count + 1)
                  pulseShake()
                }
                return
              }
              commit({ rewrite: false })
            }
          }}
          onPointerDown={(event) => {
            settleInput(event.currentTarget)
          }}
          value={text}
        />
        {variant === 'mini' && replaying ? (
          <div
            aria-hidden="true"
            className="pointer-events-none -mt-9 h-9 rounded-[6px] px-3 py-[0.43rem] font-mono text-foreground text-sm"
          >
            <TextEffect
              key={replayKey}
              per="char"
              preset="fade"
              stagger={0.015}
              triggerKey={replayKey}
            >
              {text}
            </TextEffect>
          </div>
        ) : null}
        <p className="text-muted-foreground text-sm" id={hintId}>
          Try <span className="font-mono text-foreground">10kg +/-2</span> or drag either thumb.
        </p>
        {committedError ? (
          <p className="text-destructive text-sm" id={errorId}>
            {result.issues[0]?.message}
          </p>
        ) : (
          <span className="sr-only" id={errorId} />
        )}
      </div>

      <Slider
        ariaLabel={['Minimum weight', 'Maximum weight']}
        ariaLabelledBy={labelId}
        className="py-1"
        getAriaValueText={(value) => formatKg(value)}
        max={MAX}
        min={MIN}
        onValueChange={(next) => {
          onUserInteraction?.()
          handleSliderChange(next)
        }}
        step={STEP}
        value={values}
      />
      <div className="numeric-mono -mt-3 flex justify-between text-[11px] text-muted-foreground">
        <span>{formatKg(MIN)}</span>
        <span>{formatKg(MAX)}</span>
      </div>
      <div aria-live="polite" className="numeric-mono text-muted-foreground text-xs">
        Selected{' '}
        <span className="text-foreground">
          <SelectedRangeValue values={values} />
        </span>
      </div>
    </div>
  )

  if (variant === 'mini') {
    return <div className={cn('grid gap-5', className)}>{controls}</div>
  }

  return (
    <DocsSplitPane className={className}>
      <DocsPane className="gap-4">{controls}</DocsPane>
      <JsonView
        className="h-full"
        heightClassName="h-[22rem]"
        label="View config"
        value={configJson}
      />
    </DocsSplitPane>
  )
}
