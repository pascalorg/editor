'use client'

import { m, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AnimatedNumber } from '@/components/motion/animated-number'
import { JsonView } from '@/components/site/json-view'
import { useViewReveal } from '@/components/site/use-view-reveal'
import { Badge } from '@/components/ui/badge'
import {
  type DisplayResult,
  issueClass,
  resultConfidence,
  resultIssues,
  resultKindLabel,
  resultToPlain,
  resultValueLabel,
} from '@/lib/lingo-display'
import { cn } from '@/lib/utils'

const TOKEN_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

interface ReadoutProps {
  animateNumbers?: boolean
  className?: string
  compact?: boolean
  result: DisplayResult | null
  showJson?: boolean
  surface?: 'plain' | 'raised'
}

interface HeaderSnapshot {
  confidence: number
  key: string
  kind: string
  ok: boolean
  primaryNumber: {
    value: number
    format: (value: number) => string
  } | null
  status: string
  value: string
}

// Intl.NumberFormat construction is expensive; cache per decimal width (the
// only varying option) instead of rebuilding on every animated frame.
const DECIMAL_FORMATTERS = new Map<number, Intl.NumberFormat>()

function formatterForDecimals(decimals: number) {
  let formatter = DECIMAL_FORMATTERS.get(decimals)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    })
    DECIMAL_FORMATTERS.set(decimals, formatter)
  }
  return formatter
}

function formatLikeFinalValue(finalText: string) {
  const match = /[-+]?\d+(?:[.,](\d+))?/.exec(finalText)
  if (!match) {
    return () => finalText
  }

  const decimals = match[1]?.length ?? 0
  const prefix = finalText.slice(0, match.index)
  const suffix = finalText.slice(match.index + match[0].length)
  const formatter = formatterForDecimals(decimals)

  return (value: number) => `${prefix}${formatter.format(value)}${suffix}`
}

function primaryNumberFor(result: DisplayResult | null, value: string) {
  if (!result?.ok) {
    return null
  }

  switch (result.type) {
    case 'quantity':
      return 'value' in result.quantity
        ? { value: result.quantity.value, format: formatLikeFinalValue(value) }
        : null
    case 'conversion':
      return 'value' in result.converted
        ? { value: result.converted.value, format: formatLikeFinalValue(value) }
        : null
    case 'number':
      return { value: result.value, format: formatLikeFinalValue(value) }
    default:
      return null
  }
}

function snapshotFor(result: DisplayResult | null): HeaderSnapshot {
  const confidence = resultConfidence(result)
  const value = resultValueLabel(result)
  return {
    key: JSON.stringify(resultToPlain(result)),
    value,
    status: result?.ok ? 'parsed' : result ? 'blocked' : 'idle',
    kind: resultKindLabel(result),
    confidence,
    ok: Boolean(result?.ok),
    primaryNumber: primaryNumberFor(result, value),
  }
}

function ReadoutToken({
  children,
  className,
  index,
  animated = true,
}: {
  children: ReactNode
  className?: string
  index: number
  animated?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const { ref: revealRef, revealed } = useViewReveal<HTMLDivElement>({
    amount: 0.01,
    disabled: Boolean(reduceMotion),
    fallbackMs: 500,
  })

  if (!animated) {
    return <div className={cn('result-token', className)}>{children}</div>
  }

  return (
    <m.div
      animate={revealed ? { y: 0 } : { y: 4 }}
      className={className}
      initial={reduceMotion ? false : { y: 4 }}
      ref={revealRef}
      transition={{
        duration: 0.2,
        delay: reduceMotion ? 0 : index * 0.07,
        ease: TOKEN_EASE,
      }}
    >
      {children}
    </m.div>
  )
}

function ReadoutHeader({
  snapshot,
  compact,
  animated = true,
  animateNumbers = false,
}: {
  snapshot: HeaderSnapshot
  compact: boolean
  animated?: boolean
  animateNumbers?: boolean
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <ReadoutToken
          animated={animated}
          className={cn(
            'numeric-mono break-words font-semibold leading-tight',
            compact ? 'text-xl' : 'text-3xl',
          )}
          index={0}
        >
          {animateNumbers && snapshot.primaryNumber ? (
            <AnimatedNumber
              format={snapshot.primaryNumber.format}
              value={snapshot.primaryNumber.value}
            />
          ) : (
            snapshot.value
          )}
        </ReadoutToken>
        <div className="numeric-mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <ReadoutToken animated={animated} index={1}>
            <span className={cn('text-foreground', !snapshot.ok && 'text-destructive')}>
              {snapshot.status}
            </span>
          </ReadoutToken>
          <ReadoutToken animated={animated} index={2}>
            <span>{snapshot.kind}</span>
          </ReadoutToken>
        </div>
      </div>
      <ReadoutToken animated={animated} className="flex w-32 shrink-0 flex-col gap-1" index={3}>
        <div className="flex justify-between text-muted-foreground text-xs">
          <span>confidence</span>
          <span className="numeric-mono">
            {animateNumbers ? (
              <AnimatedNumber
                format={(value) => `${Math.round(value)}%`}
                value={snapshot.confidence}
              />
            ) : (
              `${snapshot.confidence}%`
            )}
          </span>
        </div>
        <div className="h-0.5 overflow-hidden rounded-full bg-foreground/20">
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-[var(--motion-fast)] ease-[var(--ease-out)]"
            style={{ width: `${snapshot.confidence}%` }}
          />
        </div>
      </ReadoutToken>
    </div>
  )
}

export function Readout({
  result,
  compact = false,
  className,
  animateNumbers = false,
  showJson = true,
  surface = 'raised',
}: ReadoutProps) {
  const issues = resultIssues(result)
  const snapshot = useMemo(() => snapshotFor(result), [result])
  const currentRef = useRef(snapshot)
  const [exiting, setExiting] = useState<HeaderSnapshot | null>(null)

  useEffect(() => {
    if (currentRef.current.key === snapshot.key) {
      return
    }
    setExiting(currentRef.current)
    currentRef.current = snapshot
    const timeout = window.setTimeout(() => setExiting(null), 220)
    return () => window.clearTimeout(timeout)
  }, [snapshot])

  return (
    <div
      className={cn(
        'corner-smooth flex min-w-0 flex-col text-foreground',
        surface === 'raised'
          ? 'rounded-[8px] bg-card p-4 shadow-[var(--surface-ring)]'
          : 'rounded-none bg-transparent p-0 shadow-none',
        compact ? 'gap-3' : 'gap-4',
        className,
      )}
      data-slot="readout-surface"
    >
      <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
        {exiting ? (
          <div aria-hidden="true" className="result-token-exit pointer-events-none">
            <ReadoutHeader animated={false} compact={compact} snapshot={exiting} />
          </div>
        ) : null}
        <div>
          <ReadoutHeader animateNumbers={animateNumbers} compact={compact} snapshot={snapshot} />
        </div>
      </div>

      <div className="flex min-h-6 flex-wrap items-start gap-1.5 overflow-visible">
        {issues.length > 0 ? (
          issues.map((issue) => (
            <Badge
              className={cn(
                'numeric-mono max-w-full whitespace-normal break-words',
                issueClass(issue.severity),
              )}
              key={`${issue.code}:${issue.severity}:${issue.message}:${issue.span ? `${issue.span.start}-${issue.span.end}` : 'none'}:badge`}
              title={issue.message}
              variant="outline"
            >
              {issue.severity}:{issue.code}
              {issue.span ? ` [${issue.span.start},${issue.span.end})` : ''}
            </Badge>
          ))
        ) : (
          <Badge className="numeric-mono" variant="secondary">
            no issues
          </Badge>
        )}
      </div>

      <div className="min-h-11 text-sm">
        {issues.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {issues.map((issue) => (
              <p
                className="text-muted-foreground"
                key={`${issue.code}:${issue.severity}:${issue.message}:${issue.span ? `${issue.span.start}-${issue.span.end}` : 'none'}:message`}
              >
                <span className="numeric-mono inline-block whitespace-nowrap break-normal text-foreground">
                  {issue.code}
                </span>
                {': '}
                {issue.message}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {showJson ? (
        <JsonView
          heightClassName="h-64"
          label="Raw JSON"
          value={JSON.stringify(resultToPlain(result), null, 2)}
        />
      ) : null}
    </div>
  )
}
