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

const ICON_SHORTCUTS = {
  ArrowKeys: {
    icon: 'icon-park-outline:arrow-keys',
    label: 'Arrow keys',
  },
} as const

type ShortcutTokenProps = React.ComponentProps<'kbd'> & {
  value: string
  displayValue?: string
}

function ShortcutToken({ className, displayValue, value, ...props }: ShortcutTokenProps) {
  const mouseShortcut =
    value in MOUSE_SHORTCUTS ? MOUSE_SHORTCUTS[value as keyof typeof MOUSE_SHORTCUTS] : null
  const iconShortcut =
    value in ICON_SHORTCUTS ? ICON_SHORTCUTS[value as keyof typeof ICON_SHORTCUTS] : null

  return (
    <kbd
      aria-label={mouseShortcut?.label ?? iconShortcut?.label ?? displayValue ?? value}
      className={cn(
        'inline-flex h-6 items-center rounded border border-border bg-muted px-2 font-medium font-mono text-[11px] text-muted-foreground',
        (mouseShortcut || iconShortcut) && 'justify-center px-1.5',
        className,
      )}
      title={mouseShortcut?.label ?? iconShortcut?.label ?? value}
      {...props}
    >
      {mouseShortcut || iconShortcut ? (
        <>
          <Icon
            aria-hidden="true"
            className="shrink-0"
            color="currentColor"
            height={14}
            icon={(mouseShortcut ?? iconShortcut)!.icon}
            width={14}
          />
          <span className="sr-only">{(mouseShortcut ?? iconShortcut)!.label}</span>
        </>
      ) : (
        (displayValue ?? value)
      )}
    </kbd>
  )
}

export { ShortcutToken }
