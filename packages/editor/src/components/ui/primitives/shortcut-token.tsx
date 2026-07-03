import { Icon } from '@iconify/react'
import type * as React from 'react'

import { cn } from '../../../lib/utils'

const MOUSE_SHORTCUTS = {
  Click: {
    icon: 'ph:mouse-left-click-fill',
    label: 'Left click',
  },
  'Left click': {
    icon: 'ph:mouse-left-click-fill',
    label: 'Left click',
  },
  'Middle click': {
    icon: 'qlementine-icons:mouse-middle-button-16',
    label: 'Middle click',
  },
  'Right click': {
    icon: 'ph:mouse-right-click-fill',
    label: 'Right click',
  },
} as const

// The platform-agnostic command modifier. Both Cmd and Ctrl bind the action; we
// render the symbol for the *current* device so the hint reads native (⌘ on Mac,
// Ctrl elsewhere) without implying only one of them works.
const COMMAND_VALUES = new Set(['Cmd/Ctrl', 'Cmd', 'Command', 'Meta'])

// Resolved once on the client at module load — the editor HUD is client-only, so
// there's no server render to mismatch against. `navigator.platform` is enough
// here and matches the detection used elsewhere (floorplan rotate hint).
const IS_MAC =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

type ShortcutTokenProps = React.ComponentProps<'kbd'> & {
  value: string
  displayValue?: string
}

function ShortcutToken({ className, displayValue, value, ...props }: ShortcutTokenProps) {
  const mouseShortcut =
    value in MOUSE_SHORTCUTS ? MOUSE_SHORTCUTS[value as keyof typeof MOUSE_SHORTCUTS] : null
  const isCommand = COMMAND_VALUES.has(value)
  const isShift = value === 'Shift'
  const commandDisplay = IS_MAC ? '⌘' : 'Ctrl'
  const commandLabel = IS_MAC ? 'Command' : 'Control'

  return (
    <kbd
      aria-label={
        mouseShortcut?.label ??
        (isCommand ? commandLabel : isShift ? 'Shift' : (displayValue ?? value))
      }
      className={cn(
        'inline-flex h-6 items-center rounded border border-border bg-muted px-2 font-medium font-mono text-[11px] text-muted-foreground',
        (mouseShortcut || isShift) && 'justify-center px-1.5',
        className,
      )}
      title={mouseShortcut?.label ?? (isCommand ? commandLabel : isShift ? 'Shift' : value)}
      {...props}
    >
      {mouseShortcut ? (
        <>
          <Icon
            aria-hidden="true"
            className="shrink-0"
            color="currentColor"
            height={14}
            icon={mouseShortcut.icon}
            width={14}
          />
          <span className="sr-only">{mouseShortcut.label}</span>
        </>
      ) : isShift ? (
        // Icon rather than the ⇧ text glyph — the font renders the glyph's
        // crossbar too high to read as the shift key symbol.
        <>
          <Icon
            aria-hidden="true"
            className="shrink-0"
            color="currentColor"
            height={13}
            icon="ph:arrow-fat-up"
            width={13}
          />
          <span className="sr-only">Shift</span>
        </>
      ) : isCommand ? (
        // The ⌘ glyph reads small next to letters at the same font size, so bump
        // it up a touch on Mac. "Ctrl" stays at the token's normal size.
        <span className={IS_MAC ? 'text-[13px] leading-none' : undefined}>{commandDisplay}</span>
      ) : (
        (displayValue ?? value)
      )}
    </kbd>
  )
}

export { ShortcutToken }
