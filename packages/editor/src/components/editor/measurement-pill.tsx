'use client'

import {
  type ComponentPropsWithoutRef,
  type ForwardedRef,
  Fragment,
  type ReactNode,
  forwardRef,
} from 'react'

// Canonical in-world dimension formatter — metric metres or imperial
// feet/inches. Shared by every measurement readout so they read the same.
export function formatMeasurement(value: number, unit: 'metric' | 'imperial'): string {
  if (unit === 'imperial') {
    const feet = value * 3.280_84
    const wholeFeet = Math.floor(feet)
    const inches = Math.round((feet - wholeFeet) * 12)
    if (inches === 12) return `${wholeFeet + 1}'0"`
    return `${wholeFeet}'${inches}"`
  }
  return `${Number.parseFloat(value.toFixed(2))}m`
}

type MeasurePart = 'height' | 'length' | 'thickness'

const PART_ORDER: { key: MeasurePart; prefix: string }[] = [
  { key: 'height', prefix: 'H' },
  { key: 'length', prefix: 'L' },
  { key: 'thickness', prefix: 'T' },
]

export interface DimensionPillPart {
  key: string
  prefix: string
  value: number
  /** Render an explicit +/- sign — for deltas rather than absolute sizes. */
  signed?: boolean
}

export const DIMENSION_PILL_SHELL_CLASS_NAME =
  'flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur'

export const DIMENSION_PILL_PRIMARY_CLASS_NAME = 'font-medium text-foreground'
export const DIMENSION_PILL_MUTED_CLASS_NAME = 'text-muted-foreground'

export function DimensionPillShell({
  children,
  className,
  ...props
}: {
  children: ReactNode
  className?: string
} & ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={[DIMENSION_PILL_SHELL_CLASS_NAME, className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * Generic floating dimension pill: a row of `prefix value` readouts with the
 * active one emphasised. Styled to match the top-center floating info bar
 * (rounded-full, design-token colours) so it tracks the app theme.
 *
 * `primaryRef` points at the primary value's `<span>` so a caller driving a
 * per-frame drag can rewrite its text imperatively without a React re-render.
 */
export function DimensionPill({
  parts,
  unit,
  primary,
  primaryRef,
}: {
  parts: DimensionPillPart[]
  unit: 'metric' | 'imperial'
  primary?: string
  primaryRef?: ForwardedRef<HTMLSpanElement>
}) {
  return (
    <DimensionPillShell>
      {parts.map((part, index) => {
        const text = part.signed
          ? `${part.value < 0 ? '-' : '+'}${formatMeasurement(Math.abs(part.value), unit)}`
          : formatMeasurement(part.value, unit)
        return (
          <Fragment key={part.key}>
            {index > 0 ? (
              <span aria-hidden className={DIMENSION_PILL_MUTED_CLASS_NAME}>
                ·
              </span>
            ) : null}
            <span
              className={
                part.key === primary
                  ? DIMENSION_PILL_PRIMARY_CLASS_NAME
                  : DIMENSION_PILL_MUTED_CLASS_NAME
              }
              ref={part.key === primary ? primaryRef : undefined}
            >
              {`${part.prefix} ${text}`}
            </span>
          </Fragment>
        )
      })}
    </DimensionPillShell>
  )
}

/**
 * Floating dimension pill shown during wall / fence drags: `H · L · T` with
 * the actively-dragged dimension emphasised.
 *
 * The forwarded ref points at the `primary` value's `<span>` so a caller
 * driving a per-frame drag (the height arrow) can rewrite its text
 * imperatively without a React re-render. Callers that re-render naturally
 * (the endpoint tools) ignore the ref and just pass live values as props.
 */
export const MeasurementPill = forwardRef(function MeasurementPill(
  {
    height,
    length,
    thickness,
    unit,
    primary,
  }: {
    height: number
    length: number
    thickness: number
    unit: 'metric' | 'imperial'
    primary: MeasurePart
  },
  primaryRef: ForwardedRef<HTMLSpanElement>,
) {
  const values: Record<MeasurePart, number> = { height, length, thickness }
  return (
    <DimensionPill
      parts={PART_ORDER.map((part) => ({ ...part, value: values[part.key] }))}
      primary={primary}
      primaryRef={primaryRef}
      unit={unit}
    />
  )
})
