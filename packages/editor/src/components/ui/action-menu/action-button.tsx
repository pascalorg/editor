import * as React from 'react'
import { Button } from './../../../components/ui/primitives/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './../../../components/ui/primitives/tooltip'
import { cn } from './../../../lib/utils'

interface ActionButtonProps extends React.ComponentProps<typeof Button> {
  label: string
  shortcut?: string
  isActive?: boolean
  tooltipContent?: React.ReactNode
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  (
    { className, children, label, shortcut, isActive, tooltipContent, tooltipSide, ...props },
    ref,
  ) => {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn('relative h-11 w-11 transition-all', className)}
            ref={ref}
            {...props}
          >
            <div
              className={cn(
                'flex h-full w-full items-center justify-center transition-transform',
                shortcut && '-translate-x-0.5 -translate-y-0.5',
              )}
            >
              {children}
            </div>
            {shortcut && (
              <div className="absolute right-1 bottom-1 rounded border border-border/40 bg-background/40 px-1 py-[2px] backdrop-blur-md">
                <span className="block font-medium font-mono text-[9px] text-muted-foreground/70 leading-none">
                  {shortcut}
                </span>
              </div>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          {tooltipContent || (
            <p>
              {label} {shortcut && `(${shortcut})`}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    )
  },
)
ActionButton.displayName = 'ActionButton'
