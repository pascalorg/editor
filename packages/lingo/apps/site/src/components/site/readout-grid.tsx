import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function ReadoutGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('grid gap-2 text-xs', className)} data-slot="readout-grid">
      {children}
    </dl>
  )
}

export function ReadoutGridItem({
  label,
  children,
  className,
  valueClassName,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
  valueClassName?: string
}) {
  return (
    <div
      className={cn(
        'numeric-mono flex min-w-0 items-center justify-between gap-3 rounded-md bg-muted/25 px-3 py-2',
        className,
      )}
      data-slot="readout-grid-item"
    >
      <dt className="min-w-0 break-words text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words text-foreground', valueClassName)}>{children}</dd>
    </div>
  )
}
