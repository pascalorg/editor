'use client'

import { cn } from '@/lib/utils'

interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { label: React.ReactNode; value: T }[]
  className?: string
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={cn("flex h-9 w-full items-center rounded-lg border border-border/50 bg-[#2C2C2E] p-[3px]", className)}>
      {options.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex h-full flex-1 items-center justify-center rounded-md text-xs font-medium transition-all duration-200",
              isSelected
                ? "bg-[#3e3e3e] text-foreground shadow-sm ring-1 ring-border/50"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
            )}
          >
            <span className="relative z-10 flex items-center gap-1.5">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
