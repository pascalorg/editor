'use client'

import { translate } from '../../../lib/i18n'
import { useUiPreferences } from '../../../lib/ui-preferences'
import { cn } from '../../../lib/utils'

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode
  label: string
}

export function ActionButton({ icon, label, className, ...props }: ActionButtonProps) {
  const locale = useUiPreferences((state) => state.locale)
  return (
    <button
      {...props}
      className={cn(
        'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-secondary px-3 font-medium text-foreground text-xs transition-colors hover:bg-accent active:bg-accent',
        className,
      )}
    >
      {icon}
      <span>{translate(label, locale)}</span>
    </button>
  )
}

export function ActionGroup({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('flex gap-1.5', className)}>{children}</div>
}
