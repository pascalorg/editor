'use client'

import { ChevronDownIcon } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LOCALE_META, type LocaleChoice, localeMeta } from '@/lib/locale-meta'
import { cn } from '@/lib/utils'

function LocaleFlag({ flag, className }: { flag: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center text-[1.125rem] leading-none',
        className,
      )}
    >
      {flag}
    </span>
  )
}

function LocaleOptionLabel({ flag, label }: { flag: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LocaleFlag flag={flag} />
      <span className="truncate">{label}</span>
    </span>
  )
}

export function LocaleSelect({
  className,
  id,
  onValueChange,
  value,
}: {
  className?: string
  id?: string
  onValueChange: (value: LocaleChoice) => void
  value: LocaleChoice
}) {
  const current = localeMeta(value) ?? LOCALE_META[0]!

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Locale"
        className={cn(
          'inline-flex h-8 w-full min-w-36 cursor-pointer items-center justify-between gap-2 rounded-lg border border-transparent bg-[var(--control-background)] py-1 pr-2 pl-2.5 text-sm shadow-[var(--surface-ring)] outline-none transition-[background-color,color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--control-hover-background)] focus-visible:border-[var(--control-focus-border)] focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-[var(--control-hover-background)]',
          className,
        )}
        id={id}
      >
        <LocaleOptionLabel flag={current.flag} label={current.label} />
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" sideOffset={6}>
        <DropdownMenuRadioGroup
          onValueChange={(next) => onValueChange(next as LocaleChoice)}
          value={value}
        >
          {LOCALE_META.map((entry) => (
            <DropdownMenuRadioItem key={entry.value} value={entry.value}>
              <LocaleOptionLabel flag={entry.flag} label={entry.label} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function LocaleBadge({ locale }: { locale: string | undefined }) {
  const meta = localeMeta(locale)
  if (!meta) {
    return <span className="numeric-mono text-foreground">{locale ?? '—'}</span>
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <LocaleFlag className="size-4 text-base" flag={meta.flag} />
      <span className="numeric-mono text-foreground">{meta.value}</span>
    </span>
  )
}
