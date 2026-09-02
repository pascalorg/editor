'use client'

import { Icon } from '@iconify/react'
import type * as React from 'react'

import { cn } from '../../../lib/utils'
import { useTranslations } from '../../../lib/i18n'

// Mouse + key labels live as i18n keys so screen-reader / tooltip text
// follows the active locale. The map below is keyed on the raw string passed
// to <ShortcutToken>; on the component side the renderer looks up the
// matching label via `t()`.
const MOUSE_SHORTCUTS: Record<string, { icon: string; labelKey: string }> = {
  Click: {
    icon: 'ph:mouse-left-click-fill',
    labelKey: 'keys.leftClick',
  },
  'Left click': {
    icon: 'ph:mouse-left-click-fill',
    labelKey: 'keys.leftClick',
  },
  'Middle click': {
    icon: 'qlementine-icons:mouse-middle-button-16',
    labelKey: 'keys.middleClick',
  },
  'Right click': {
    icon: 'ph:mouse-right-click-fill',
    labelKey: 'keys.rightClick',
  },
}

// The platform-agnostic command modifier. Both Cmd and Ctrl bind the action; we
// render the symbol for the *current* device so the hint reads native (⌘ on Mac,
// Ctrl elsewhere) without implying only one of them works.
const COMMAND_VALUES = new Set(['Cmd/Ctrl', 'Cmd', 'Command', 'Meta'])

// Resolved once on the client at module load — the editor HUD is client-only, so
// there's no server render to mismatch against. `navigator.platform` is enough
// here and matches the detection used elsewhere (floorplan rotate hint).
const IS_MAC =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

// Keys whose printed name and their symbol differ. Kept beside the token rather
// than in any one consumer so every surface that prints a shortcut — the
// Keyboard Shortcuts dialog, the community getting-started guide — resolves the
// same glyph for the same key.
//
// Only symbols people actually read are listed. The arrows are unambiguous, and
// ⌘ is printed on the key it means. The rest are not: ⎋, ␣ and ⌫ are typographic
// conventions that no keyboard prints, so they read as "some symbol" rather than
// as Escape, Space and Delete. Those spell their names out instead — and for
// Delete, the name the current platform actually puts on the keycap.
const KEY_DISPLAY_MAP: Record<string, string> = {
  'Arrow Down': '↓',
  'Arrow Up': '↑',
}

/** The glyph to print for a shortcut key on the current platform. */
function shortcutDisplayValue(value: string): string {
  if (COMMAND_VALUES.has(value)) return IS_MAC ? '⌘' : 'Ctrl'
  if (value === 'Delete / Backspace') return IS_MAC ? 'Delete' : 'Backspace'
  return KEY_DISPLAY_MAP[value] ?? value
}

type ShortcutTokenProps = React.ComponentProps<'kbd'> & {
  value: string
  displayValue?: string
}

function ShortcutToken({ className, displayValue, value, ...props }: ShortcutTokenProps) {
  const t = useTranslations()
  const mouseShortcut =
    value in MOUSE_SHORTCUTS ? MOUSE_SHORTCUTS[value] : null
  const isCommand = COMMAND_VALUES.has(value)
  const isShift = value === 'Shift'
  const commandDisplay = IS_MAC ? '⌘' : 'Ctrl'
  const commandLabel = IS_MAC ? t('keys.commandMac') : t('keys.control')
  const shiftLabel = t('keys.shift')
  const mouseLabel = mouseShortcut ? t(mouseShortcut.labelKey) : null

  return (
    <kbd
      aria-label={
        mouseLabel ??
        (isCommand ? commandLabel : isShift ? shiftLabel : (displayValue ?? value))
      }
      className={cn(
        'inline-flex h-6 items-center rounded border border-border bg-muted px-2 font-medium font-mono text-[11px] text-muted-foreground',
        (mouseShortcut || isShift) && 'justify-center px-1.5',
        className,
      )}
      title={mouseLabel ?? (isCommand ? commandLabel : isShift ? shiftLabel : value)}
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
          <span className="sr-only">{mouseLabel}</span>
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
          <span className="sr-only">{shiftLabel}</span>
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

export { ShortcutToken, shortcutDisplayValue }
