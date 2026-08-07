'use client'

import { cn, formatLinearMeasurement } from '@pascal-app/editor'

/**
 * The primitives the formwork readouts are built from.
 *
 * Shared rather than repeated because the design report and the parts table are
 * two views of one solve, read one after the other in the same panel: the report
 * says the walers are at 300 mm and 92 % worked, the table says which nine walers
 * those are. A member at 92 % has to be the same amber in both, or the second
 * screen quietly disagrees with the first about how close to capacity the shutter
 * is.
 */

export type UnitSystem = 'metric' | 'imperial'

/**
 * Where a member's utilisation stops being comfortable. Over 1.0 is over capacity
 * and always red; the amber band below it is the range where a small change in the
 * pour — a faster rise, a colder morning — puts it over.
 */
const UTILISATION_TIGHT = 0.85

export function utilisationClass(value: number): string {
  if (value > 1 + 1e-6) return 'text-red-400'
  if (value >= UTILISATION_TIGHT) return 'text-amber-500'
  return 'text-foreground/90'
}

export function mm(meters: number, unit: UnitSystem): string {
  return formatLinearMeasurement(meters, unit, 'millimeters')
}

export function WarningLine({ message }: { message: string }) {
  return <div className="text-[10px] text-amber-500 leading-snug">{message}</div>
}

export function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="space-y-1 rounded-md border border-border/40 px-2 py-1.5">
      <div className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
        {title}
      </div>
      {children}
    </div>
  )
}

export function Readout({
  label,
  value,
  value2,
  warn,
}: {
  label: string
  value: string
  value2?: string
  warn?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        {value2 && <span className="text-[10px] text-muted-foreground/70">{value2}</span>}
        <span className={cn('font-mono', warn ? 'text-red-400' : 'text-foreground/90')}>
          {value}
        </span>
      </span>
    </div>
  )
}

export function Note({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-muted-foreground/80 leading-snug">{children}</div>
}
