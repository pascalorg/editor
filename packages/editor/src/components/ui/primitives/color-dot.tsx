'use client'

import { ZONE_COLOR_PALETTE } from '@pascal-app/core'
import { useState } from 'react'
import { cn } from '../../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export const PALETTE_COLORS = ZONE_COLOR_PALETTE

interface ColorDotProps {
  color: string
  onChange: (color: string) => void
  /** Says what the colour is for, on hover and to assistive tech. */
  label?: string
  side?: 'left' | 'bottom'
}

export function ColorDot({ color, onChange, label, side = 'left' }: ColorDotProps) {
  const [open, setOpen] = useState(false)
  const trigger = (
    <PopoverTrigger asChild>
      <button
        aria-label={label}
        className="relative h-3 w-3 shrink-0 cursor-pointer rounded-sm border border-border/50 transition-all hover:ring-1 hover:ring-ring/50"
        data-color-dot
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: color }}
        type="button"
      />
    </PopoverTrigger>
  )

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {label ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent
        align={side === 'bottom' ? 'start' : 'center'}
        className="w-auto p-1.5"
        // Keep the pick inside the palette: in a panel header, a pointerdown
        // bubbling out of the portal would start dragging the panel.
        onPointerDown={(event) => event.stopPropagation()}
        side={side}
        sideOffset={6}
      >
        <div className="grid grid-cols-4 gap-1">
          {PALETTE_COLORS.map((c) => (
            <button
              className={cn(
                'h-5 w-5 rounded-sm border transition-transform hover:scale-110',
                c === color ? 'border-foreground/50 ring-1 ring-ring/50' : 'border-border/30',
              )}
              key={c}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
              style={{ backgroundColor: c }}
              type="button"
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
