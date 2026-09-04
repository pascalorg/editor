import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 font-medium text-xs transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] focus-visible:border-[var(--control-focus-border)] focus-visible:ring-3 focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-[var(--control-invalid-border)] aria-invalid:ring-3 aria-invalid:ring-[var(--control-invalid-ring)] [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default:
          'border-[var(--badge-default-border)] bg-[var(--badge-default-background)] text-[var(--badge-default-foreground)] [a]:hover:bg-[var(--badge-default-hover-background)]',
        secondary:
          'border-[var(--badge-secondary-border)] bg-[var(--badge-secondary-background)] text-[var(--badge-secondary-foreground)] [a]:hover:bg-[var(--badge-secondary-hover-background)]',
        destructive:
          'border-[var(--badge-destructive-border)] bg-[var(--badge-destructive-background)] text-[var(--badge-destructive-foreground)] focus-visible:ring-[var(--control-invalid-ring)] [a]:hover:bg-[var(--badge-destructive-hover-background)]',
        outline:
          'border-[var(--badge-outline-border)] bg-[var(--badge-outline-background)] text-[var(--badge-outline-foreground)] [a]:hover:bg-[var(--badge-outline-hover-background)]',
        ghost:
          'border-transparent bg-transparent text-[var(--badge-muted-foreground)] hover:bg-[var(--badge-outline-hover-background)] hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  })
}

export { Badge, badgeVariants }
