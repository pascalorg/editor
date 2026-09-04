import type * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'field-sizing-content min-h-20 w-full min-w-0 resize-y rounded-lg border border-transparent bg-[var(--control-background)] px-3 py-2 text-base text-foreground leading-6 shadow-[var(--surface-ring)] outline-none transition-[background-color,color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] placeholder:text-muted-foreground/75 hover:bg-[var(--control-hover-background)] focus-visible:border-[var(--control-focus-border)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-[var(--control-disabled-background)] disabled:opacity-50 aria-invalid:border-[var(--control-invalid-border)] aria-invalid:ring-3 aria-invalid:ring-[var(--control-invalid-ring)] md:text-sm',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  )
}

export { Textarea }
