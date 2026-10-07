'use client'

import { ChevronDown } from 'lucide-react'
import { cn } from '../../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'

interface SelectControlProps<T extends string> {
  label: string
  value: T
  onChange: (value: T) => void
  options: { label: string; value: T }[]
  className?: string
  mixed?: boolean
}

export function SelectControl<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
  mixed = false,
}: SelectControlProps<T>) {
  const current = mixed ? 'Mixed' : options.find((option) => option.value === value)?.label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            'group flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm transition-colors hover:bg-[#3e3e3e] data-[state=open]:bg-[#3e3e3e]',
            className,
          )}
          type="button"
        >
          <span className="select-none text-muted-foreground transition-colors group-hover:text-foreground">
            {label}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            <span className="truncate">{current}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuRadioGroup
          onValueChange={(next) => onChange(next as T)}
          value={mixed ? '' : value}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
