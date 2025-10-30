'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

interface OpacityControlProps {
  visible?: boolean
  opacity?: number
  onVisibilityToggle: () => void
  onOpacityChange: (opacity: number) => void
  className?: string
}

export function OpacityControl({
  visible = true,
  opacity = 100,
  onVisibilityToggle,
  onOpacityChange,
  className,
}: OpacityControlProps) {
  const [isOpen, setIsOpen] = useState(false)
  const actualOpacity = opacity ?? 100
  const isHidden = visible === false || actualOpacity === 0

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <div className={cn('flex items-center gap-1', className)}>
        {!isHidden && actualOpacity < 100 && (
          <span className="text-muted-foreground text-xs">{actualOpacity}%</span>
        )}
        <PopoverTrigger asChild>
          <Button
            className={cn(
              'h-5 w-5 p-0 transition-opacity',
              isHidden ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100',
            )}
            onClick={(e) => {
              e.stopPropagation()
              // If clicking the button (not opening popover), toggle visibility
              if (!isOpen) {
                onVisibilityToggle()
              }
            }}
            size="sm"
            variant="ghost"
          >
            {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-48 p-3"
          onClick={(e) => e.stopPropagation()}
          side="right"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Opacity</span>
              <span className="text-muted-foreground text-xs">{actualOpacity}%</span>
            </div>
            <Slider
              max={100}
              min={0}
              onValueChange={([value]) => {
                onOpacityChange(value)
              }}
              step={1}
              value={[actualOpacity]}
            />
          </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}
