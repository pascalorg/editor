'use client'

import { cn } from '../../../lib/utils'

interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  /**
   * `disabled` greys one option and ignores its click; it stays hoverable, so a tooltip in its
   * `label` can say why.
   */
  options: { label: React.ReactNode; value: T; disabled?: boolean }[]
  className?: string
  disabled?: boolean
  mixed?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled = false,
  mixed = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        'flex min-h-9 w-full items-stretch rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] p-[3px]',
        disabled && 'opacity-60',
        className,
      )}
    >
      {options.map((option) => {
        const isSelected = !mixed && value === option.value
        const isDisabled = disabled || option.disabled === true
        return (
          <button
            aria-disabled={option.disabled || undefined}
            aria-pressed={isSelected}
            className={cn(
              'relative flex min-h-7 min-w-0 flex-1 items-center justify-center rounded-md px-1.5 py-1 font-medium text-xs leading-4 transition-colors duration-200',
              isSelected
                ? 'bg-white dark:bg-[#3e3e3e] text-foreground shadow-sm ring-1 ring-border/50'
                : 'text-muted-foreground hover:bg-black/4 dark:hover:bg-white/5 hover:text-foreground',
              isDisabled &&
                'cursor-not-allowed hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent',
              option.disabled && 'opacity-40',
            )}
            disabled={disabled}
            key={option.value}
            onClick={() => {
              if (!option.disabled) onChange(option.value)
            }}
            type="button"
          >
            <span className="relative z-10 flex min-w-0 items-center justify-center gap-1.5 whitespace-normal text-center [&>svg]:shrink-0">
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
