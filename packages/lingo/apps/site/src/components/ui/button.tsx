import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'group/button inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-clip-padding font-medium text-sm outline-none transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--ease-out)] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[var(--control-invalid-border)] aria-invalid:ring-2 aria-invalid:ring-[var(--control-invalid-ring)] [&_[data-slot=button-icon]:not([class*=size-])]:size-4 [&_[data-slot=button-icon]]:pointer-events-none [&_[data-slot=button-icon]]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[var(--button-primary-shadow)] hover:bg-primary/90 hover:shadow-[var(--button-primary-shadow-hover)] active:not-aria-[haspopup]:shadow-[var(--button-pressed-shadow)]',
        outline:
          'border-border bg-[var(--control-outline-background)] hover:bg-[var(--control-muted-hover)] hover:text-foreground aria-expanded:bg-[var(--control-muted-hover)] aria-expanded:text-foreground',
        secondary:
          'bg-card text-foreground shadow-[var(--button-secondary-shadow)] hover:bg-[color-mix(in_oklch,var(--card),var(--foreground)_3%)] hover:shadow-[var(--button-secondary-shadow-hover)] active:not-aria-[haspopup]:shadow-[var(--button-pressed-shadow)] aria-expanded:bg-card aria-expanded:text-foreground',
        ghost:
          'hover:bg-[var(--control-muted-hover)] hover:text-foreground aria-expanded:bg-[var(--control-muted-hover)] aria-expanded:text-foreground',
        destructive:
          'bg-[var(--destructive-surface)] text-destructive hover:bg-[var(--destructive-surface-hover)] focus-visible:border-[var(--destructive-focus-border)] focus-visible:ring-[var(--control-invalid-ring)]',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: 'h-6 gap-1 in-data-[slot=button-group]:rounded-lg rounded-[min(var(--radius-md),10px)] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_[data-slot=button-icon]:not([class*=size-])]:size-3 [&_svg:not([class*=size-])]:size-3',
        sm: 'h-7 gap-1 in-data-[slot=button-group]:rounded-lg rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_[data-slot=button-icon]:not([class*=size-])]:size-3.5 [&_svg:not([class*=size-])]:size-3.5',
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-8',
        'icon-xs':
          'size-6 in-data-[slot=button-group]:rounded-lg rounded-[min(var(--radius-md),10px)] [&_[data-slot=button-icon]:not([class*=size-])]:size-3 [&_svg:not([class*=size-])]:size-3',
        'icon-sm':
          'size-7 in-data-[slot=button-group]:rounded-lg rounded-[min(var(--radius-md),12px)]',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ variant, size, className }))}
      data-slot="button"
      {...props}
    />
  )
}

export { Button, buttonVariants }
