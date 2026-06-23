'use client'

import { cn } from '../../../lib/utils'

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
    <div
      className={cn(
        // Style follow-up: MeasureNavi segmented controls use light neutral control surfaces.
        'flex h-9 w-full items-center rounded-full border border-border/50 bg-secondary p-[3px]',
        className,
      )}
    >
      {options.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            className={cn(
              'relative flex h-full flex-1 items-center justify-center rounded-md font-medium text-xs transition-all duration-200',
              isSelected
                ? 'rounded-full bg-background text-foreground shadow-sm ring-1 ring-border/50'
                : 'rounded-full text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <span className="relative z-10 flex items-center gap-1.5">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
