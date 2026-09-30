'use client'

import type { MouseEventHandler, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { shortcutDisplayValue } from '../ui/primitives/shortcut-token'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/primitives/tooltip'

const BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
const DESTRUCTIVE = 'hover:bg-destructive/10 hover:text-destructive'
const DISABLED = 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground'

/**
 * One button of an action pill, with the editor's tooltip: its name, and the
 * keys that do the same where there are any. A disabled button still shows
 * its tooltip (it stays hoverable) so it can say why it is off.
 */
export function ActionMenuButton({
  label,
  keys,
  onClick,
  destructive = false,
  disabled = false,
  disabledReason,
  pressed,
  children,
}: {
  label: string
  /** Keys pressed together, as `ShortcutToken` names them (`Cmd/Ctrl`, `G`). */
  keys?: string[]
  onClick?: MouseEventHandler<HTMLButtonElement>
  destructive?: boolean
  disabled?: boolean
  /** The tooltip while disabled; the label otherwise. */
  disabledReason?: string
  /** A toggle's state: sets `aria-pressed` and the active look. */
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-disabled={disabled || undefined}
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            BUTTON,
            destructive && DESTRUCTIVE,
            disabled && DISABLED,
            pressed && 'bg-accent text-foreground',
          )}
          data-action-disabled={disabled || undefined}
          onClick={(event) => {
            if (disabled) {
              event.stopPropagation()
              return
            }
            onClick?.(event)
          }}
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2" side="top" sideOffset={6}>
        <span>{disabled && disabledReason ? disabledReason : label}</span>
        {!disabled && keys?.length ? (
          <span className="flex items-center gap-0.5">
            {keys.map((key) => (
              <kbd
                className="rounded border border-background/30 px-1 font-mono text-[10px] leading-4 opacity-80"
                key={key}
              >
                {shortcutDisplayValue(key)}
              </kbd>
            ))}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
