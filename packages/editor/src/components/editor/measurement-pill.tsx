'use client'

import { useViewer } from '@pascal-app/viewer'
import { type ForwardedRef, Fragment, forwardRef } from 'react'
import { formatLinearMeasurement, type MetricNotation } from '../../lib/measurements'

// Canonical in-world dimension formatter — metric metres or imperial
// feet/inches. Shared by every measurement readout so they read the same.
export function formatMeasurement(
  value: number,
  unit: 'metric' | 'imperial',
  metricNotation: MetricNotation = 'meters',
): string {
  return formatLinearMeasurement(value, unit, metricNotation)
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
  const metricNotation = useViewer((state) => state.metricNotation)

  return (
    <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
      {parts.map((part, index) => {
        const text = part.signed
          ? `${part.value < 0 ? '-' : '+'}${formatMeasurement(
              Math.abs(part.value),
              unit,
              metricNotation,
            )}`
          : formatMeasurement(part.value, unit, metricNotation)
        return (
          <Fragment key={part.key}>
            {index > 0 ? (
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
            ) : null}
            <span
              className={
                part.key === primary ? 'font-medium text-foreground' : 'text-muted-foreground'
              }
              ref={part.key === primary ? primaryRef : undefined}
            >
              {`${part.prefix} ${text}`}
            </span>
          </Fragment>
        )
      })}
    </div>
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
