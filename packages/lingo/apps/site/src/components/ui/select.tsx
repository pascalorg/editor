'use client'

import { ChevronDownIcon } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

export interface SelectOption {
  label: React.ReactNode
  value: string
}

function Select({
  className,
  options,
  onValueChange,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  options: SelectOption[]
  onValueChange?: (value: string) => void
}) {
  return (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select
        className="h-8 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-[var(--control-background)] py-1 pr-8 pl-2.5 text-sm shadow-[var(--surface-ring)] outline-none transition-[background-color,color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--control-hover-background)] focus-visible:border-[var(--control-focus-border)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-[var(--control-disabled-background)] disabled:opacity-50 aria-invalid:border-[var(--control-invalid-border)] aria-invalid:ring-3 aria-invalid:ring-[var(--control-invalid-ring)]"
        data-slot="select"
        onChange={(event) => onValueChange?.(event.target.value)}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  )
}

export { Select }
