'use client'

import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { m, useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

function Switch({
  className,
  size = 'default',
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: 'sm' | 'default'
}) {
  const reduceMotion = useReducedMotion()

  return (
    <m.span
      className="inline-flex"
      transition={
        reduceMotion ? undefined : { type: 'spring', stiffness: 520, damping: 36, mass: 0.4 }
      }
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
    >
      <SwitchPrimitive.Root
        className={cn(
          'peer group/switch relative inline-flex shrink-0 cursor-pointer items-center overflow-hidden rounded-full border border-transparent outline-none transition-[background-color,border-color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--ease-out)] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-[var(--control-invalid-border)] aria-invalid:ring-2 aria-invalid:ring-[var(--control-invalid-ring)] data-[size=default]:h-[18.4px] data-[size=sm]:h-[14px] data-[size=default]:w-[32px] data-[size=sm]:w-[24px] data-disabled:cursor-not-allowed data-checked:bg-primary data-unchecked:bg-[var(--switch-unchecked-background)] data-disabled:opacity-50',
          className,
        )}
        data-size={size}
        data-slot="switch"
        {...props}
      >
        <SwitchPrimitive.Thumb
          className="pointer-events-none block rounded-full bg-[var(--switch-thumb-background)] ring-0 transition-[background-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-out)] data-checked:translate-x-[calc(100%-2px)] data-checked:bg-[var(--switch-thumb-checked-background)] data-unchecked:translate-x-0 group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3"
          data-slot="switch-thumb"
        />
      </SwitchPrimitive.Root>
    </m.span>
  )
}

export { Switch }
