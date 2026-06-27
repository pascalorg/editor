'use client'

export type PathOption = {
  path: string
  label: string
  valueText: string
  category?: string
}

export function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-muted-foreground text-xs">
      {label}
      <input
        className="h-8 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground disabled:cursor-not-allowed disabled:opacity-70"
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={value}
      />
    </label>
  )
}

export function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-muted-foreground text-xs">
      {label}
      <input
        className="h-8 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground disabled:cursor-not-allowed disabled:opacity-70"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  getLabel = (option) => option,
  hideLabel = false,
  testId,
  disabled = false,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  getLabel?: (option: T) => string
  hideLabel?: boolean
  testId?: string
  disabled?: boolean
}) {
  return (
    <label className={hideLabel ? 'flex flex-col text-muted-foreground text-xs' : 'flex flex-col gap-1 text-muted-foreground text-xs'}>
      {hideLabel ? <span className="sr-only">{label}</span> : label}
      <select
        className="h-8 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground disabled:cursor-not-allowed disabled:opacity-70"
        data-testid={testId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {getLabel(option)}
          </option>
        ))}
      </select>
    </label>
  )
}
