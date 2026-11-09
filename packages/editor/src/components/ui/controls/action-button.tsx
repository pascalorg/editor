'use client'

import { cn } from '../../../lib/utils'

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode
  label: string
}

export function ActionButton({ icon, label, className, ...props }: ActionButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        // The fill runs through custom properties so a caller's `bg-*` or
        // `hover:bg-*` replaces it in both themes; tailwind-merge would keep a
        // `dark:bg-*` fill alive under the caller's class.
        'flex min-h-9 min-w-0 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-(--action-fill) px-3 py-2 font-medium text-foreground text-xs leading-4 transition-colors [&>svg]:shrink-0 [--action-fill-hover:rgb(0_0_0/0.08)] [--action-fill:rgb(0_0_0/0.04)] hover:bg-(--action-fill-hover) active:bg-(--action-fill-hover) dark:[--action-fill-hover:#3e3e3e] dark:[--action-fill:#2C2C2E]',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 whitespace-normal text-center">{label}</span>
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
