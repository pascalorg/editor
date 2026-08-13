'use client'

import * as PopoverPrimitive from '@radix-ui/react-popover'
import type * as React from 'react'

import { translateReactNode } from '../../../lib/i18n'
import { useUiPreferences } from '../../../lib/ui-preferences'
import { cn } from '../../../lib/utils'

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ children, ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const locale = useUiPreferences((state) => state.locale)
  return (
    <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props}>
      {translateReactNode(children, locale)}
    </PopoverPrimitive.Trigger>
  )
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const locale = useUiPreferences((state) => state.locale)
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        className={cn(
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[state=closed]:animate-out data-[state=open]:animate-in',
          className,
        )}
        data-slot="popover-content"
        sideOffset={sideOffset}
        {...props}
      >
        {translateReactNode(children, locale)}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
