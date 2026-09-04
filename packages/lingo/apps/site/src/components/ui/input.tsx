import { Input as InputPrimitive } from '@base-ui/react/input'
import type * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      className={cn(
        'h-11 w-full min-w-0 rounded-lg border border-transparent bg-[var(--control-background)] px-3 py-2 text-base shadow-[var(--surface-ring)] outline-none transition-[background-color,color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground/75 hover:bg-[var(--control-hover-background)] focus-visible:border-[var(--control-focus-border)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--control-disabled-background)] disabled:opacity-50 aria-invalid:border-[var(--control-invalid-border)] aria-invalid:ring-3 aria-invalid:ring-[var(--control-invalid-ring)] md:text-sm',
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  )
}

export { Input }
