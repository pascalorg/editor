'use client'

import { Check } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './../../../lib/utils'

interface CheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export function Checkbox({ checked, onCheckedChange, className, ...props }: CheckboxProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background/60 text-transparent hover:border-foreground/40',
        className,
      )}
      role="checkbox"
      type="button"
      {...props}
      onClick={(event) => {
        event.stopPropagation()
        onCheckedChange(!checked)
      }}
    >
      <Check className="h-2.5 w-2.5" strokeWidth={3} />
    </button>
  )
}
