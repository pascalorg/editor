'use client'

import { ActionButton, ActionMenuButton } from '@pascal-app/editor'
import type { MouseEventHandler } from 'react'

const paths = {
  niche:
    'M2 11l10-6 10 6-10 6z M2 11v4l10 6 10-6v-4 M12 17v4 M7 11l5-3 5 3-5 3z M7 11v3l5 3 5-3v-3 M12 14v3',
  bump: 'M2 14l10-6 10 6-10 6z M7 7l5-3 5 3-5 3z M7 7v7l5 3 5-3V7 M12 10v7',
}

export function FeatureActionButton({
  mode,
  variant = 'menu',
  disabled,
  disabledReason,
  onClick,
}: {
  mode: 'niche' | 'bump'
  variant?: 'menu' | 'panel'
  disabled?: boolean
  disabledReason?: string
  onClick: MouseEventHandler<HTMLButtonElement>
}) {
  const label = `Add ${mode}`
  const icon = (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[mode]} />
    </svg>
  )
  return variant === 'panel' ? (
    <ActionButton
      type="button"
      icon={icon}
      label={label}
      disabled={disabled}
      title={disabledReason}
      className="disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    />
  ) : (
    <ActionMenuButton
      label={label}
      disabled={disabled}
      disabledReason={disabledReason}
      onClick={onClick}
    >
      {icon}
    </ActionMenuButton>
  )
}
