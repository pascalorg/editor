'use client'

import { useState } from 'react'
import { cn } from '../../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export const PALETTE_COLORS = [
  '#ef4444', // Red        0°
  '#f97316', // Orange    30°
  '#f59e0b', // Amber     45°
  '#84cc16', // Lime      85°
  '#22c55e', // Green    142°
  '#10b981', // Emerald  160°
  '#06b6d4', // Cyan     190°
  '#3b82f6', // Blue     217°
  '#6366f1', // Indigo   239°
  '#a855f7', // Violet   270°
  '#64748b', // Dark gray
  '#cccccc', // Light gray
]

interface ColorDotProps {
  color: string
  onChange: (color: string) => void
}

export function ColorDot({ color, onChange }: ColorDotProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className="relative h-3 w-3 shrink-0 cursor-pointer rounded-sm border border-border/50 transition-all hover:ring-1 hover:ring-ring/50"
          onClick={(e) => e.stopPropagation()}
          style={{ backgroundColor: color }}
          type="button"
        />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto p-1.5" side="left" sideOffset={6}>
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
