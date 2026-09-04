import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'group/alert relative grid w-full gap-1 rounded-md bg-[var(--alert-background)] px-3 py-2.5 text-left text-[var(--alert-foreground)] text-sm shadow-[var(--alert-shadow)] has-data-[slot=alert-action]:relative has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 has-data-[slot=alert-action]:pr-18 *:[svg:not([class*=size-])]:size-4 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current',
  {
    variants: {
      variant: {
        default:
          '[--alert-background:var(--alert-default-background)] [--alert-description:var(--alert-default-description)] [--alert-foreground:var(--alert-default-foreground)] [--alert-shadow:var(--alert-default-shadow)]',
        destructive:
          '[--alert-background:var(--alert-destructive-background)] [--alert-description:var(--alert-destructive-description)] [--alert-foreground:var(--alert-destructive-foreground)] [--alert-shadow:var(--alert-destructive-shadow)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className,
      )}
      data-slot="alert-title"
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'text-balance text-[var(--alert-description,var(--muted-foreground))] text-sm md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
        className,
      )}
      data-slot="alert-description"
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('absolute top-2 right-2', className)} data-slot="alert-action" {...props} />
  )
}

export { Alert, AlertAction, AlertDescription, AlertTitle }
