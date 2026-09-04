import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// The kicker and the decorative "#" live OUTSIDE the h2/h3 so extracted
// heading text stays clean ("Install", not "packageInstall#") for search
// engines and agents reading the outline. aria-hidden hides text from
// screen readers but not from HTML text extraction.
export function SectionHeading({
  id,
  children,
  kicker,
}: {
  id: string
  children: ReactNode
  kicker?: string
}) {
  return (
    <div className="group flex flex-wrap items-center gap-x-2 gap-y-1">
      {kicker ? (
        <span className="font-medium font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
          {kicker}
        </span>
      ) : null}
      <h2 className="scroll-mt-20 font-semibold text-base tracking-tight" id={id}>
        <Link
          className="inline-flex items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          href={`#${id}`}
        >
          {children}
        </Link>
      </h2>
      <span
        aria-hidden="true"
        className="text-muted-foreground opacity-0 transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-out)] group-focus-within:opacity-100 group-hover:opacity-100"
      >
        #
      </span>
    </div>
  )
}

export function SubHeading({
  id,
  children,
  className,
}: {
  id: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('group flex items-center gap-2', className)}>
      <h3 className="scroll-mt-20 font-semibold text-[15px] tracking-tight" id={id}>
        <Link
          className="inline-flex items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          href={`#${id}`}
        >
          {children}
        </Link>
      </h3>
      <span
        aria-hidden="true"
        className="text-muted-foreground opacity-0 transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-out)] group-focus-within:opacity-100 group-hover:opacity-100"
      >
        #
      </span>
    </div>
  )
}
