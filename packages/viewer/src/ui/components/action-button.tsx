import * as React from 'react'
import { playSound } from '../../sfx/player'
import { cn } from '../lib/cn'
import { Button } from '../primitives/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { useActionMenuPopupSide } from './action-menu-placement'

interface ActionButtonProps extends React.ComponentProps<typeof Button> {
  label: string
  shortcut?: string
  isActive?: boolean
  tooltipContent?: React.ReactNode
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  /** The tooltip portals to `<body>`, so a button in a themed scope passes the scope here. */
  tooltipClassName?: string
}

export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  (
    {
      className,
      children,
      label,
      shortcut,
      isActive,
      tooltipContent,
      tooltipSide,
      tooltipClassName,
      onClick,
      onMouseEnter,
      ...props
    },
    ref,
  ) => {
    const popupSide = useActionMenuPopupSide()
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            // These are toggles, not commands: the armed/unarmed state has to be
            // readable without decoding the active-state styling.
            aria-pressed={isActive}
            // Icon-only: the tooltip text is the button's name.
            aria-label={label}
            className={cn('relative h-11 w-11 transition-all', className)}
            onClick={(event) => {
              playSound('menuClick')
              onClick?.(event)
            }}
            onMouseEnter={(event) => {
              playSound('menuHover')
              onMouseEnter?.(event)
            }}
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
        <TooltipContent className={tooltipClassName} side={tooltipSide ?? popupSide}>
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
