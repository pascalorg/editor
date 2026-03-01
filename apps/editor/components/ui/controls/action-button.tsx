'use client'

import { cn } from '@/lib/utils'

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode
  label: string
}

export function ActionButton({ icon, label, className, ...props }: ActionButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-xs font-medium text-foreground transition-colors hover:bg-[#3e3e3e] active:bg-[#3e3e3e]",
        className
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function ActionGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-1.5", className)}>
      {children}
    </div>
  )
}
