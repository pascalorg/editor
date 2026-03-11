'use client'

import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from '../../../lib/utils'

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative shrink-0 h-3 w-3 rounded-sm border border-border/50 cursor-pointer hover:ring-1 hover:ring-ring/50 transition-all"
          style={{ backgroundColor: color }}
          onClick={(e) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent side="left" align="center" sideOffset={6} className="w-auto p-1.5">
        <div className="grid grid-cols-4 gap-1">
          {PALETTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(
                'h-5 w-5 rounded-sm border transition-transform hover:scale-110',
                c === color ? 'border-foreground/50 ring-1 ring-ring/50' : 'border-border/30',
              )}
              style={{ backgroundColor: c }}
              onClick={() => { onChange(c); setOpen(false) }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
