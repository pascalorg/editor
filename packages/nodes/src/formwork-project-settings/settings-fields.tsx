'use client'

import { useId } from 'react'

/**
 * The controls the settings panel is built from.
 *
 * Every one of them can be *not set*, and that is the whole point. The design
 * chain falls back to a conservative default for each field, and `stated` is what
 * lets the design report tell an assumption from a decision — so a control that
 * writes its default on mount would silently convert every assumption in the
 * project into a claim. These therefore render the default as placeholder text
 * next to the word "assumed", and write only what the user types.
 *
 * They are local rather than taken from `@pascal-app/editor` because that package
 * exposes `SliderControl` and `MetricControl`, both of which are continuous and
 * always hold a value. A pressure code and a rate of rise are neither: the code is
 * a contract term and the rate is a figure the pump either has or has not been
 * given, and there is no slider position that means "nobody has said".
 */

/**
 * A number the project may state, or the figure the engine assumes if it does not.
 *
 * Committed on blur rather than per keystroke: each change re-solves the pressure
 * envelope and every member spacing in the scene, so typing "2.5" through a
 * per-keystroke handler would design the whole model to 2 and then to 2.5.
 */
export function OptionalNumberField({
  assumed,
  hint,
  label,
  max,
  min,
  onChange,
  step = 0.1,
  unit,
  value,
}: {
  /** What the chain uses when this is unset, already formatted. */
  assumed: string
  hint?: string
  label: string
  max?: number
  min?: number
  onChange: (value: number | undefined) => void
  step?: number
  unit?: string
  value: number | undefined
}) {
  return (
    <label className="flex flex-col gap-0.5 px-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
        <input
          className="h-7 w-20 shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-right font-mono outline-none"
          defaultValue={value ?? ''}
          // Remount when the stored value changes from elsewhere — the AI writing
          // the same field, or an undo — so the box does not keep a stale draft.
          key={`${label}-${value ?? 'assumed'}`}
          max={max}
          min={min}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim()
            if (raw === '') {
              onChange(undefined)
              return
            }
            const parsed = Number.parseFloat(raw)
            if (!Number.isFinite(parsed)) {
              onChange(undefined)
              return
            }
            if (min !== undefined && parsed < min) return
            if (max !== undefined && parsed > max) return
            onChange(parsed)
          }}
          placeholder={assumed}
          step={step}
          type="number"
        />
        {unit && <span className="w-10 shrink-0 text-muted-foreground/70">{unit}</span>}
      </div>
      <span className="text-[10px] text-muted-foreground/70 leading-snug">
        {value === undefined ? `Assumed ${assumed}${unit ? ` ${unit}` : ''}. ` : ''}
        {hint}
      </span>
    </label>
  )
}

/**
 * One of a fixed set, or unstated.
 *
 * The unstated row is first and reads "Assumed — <default>" rather than being an
 * empty option, because a blank row in a list of codes looks like a missing value
 * rather than a live conservative choice.
 */
export function OptionalSelectField<T extends string>({
  assumedLabel,
  hint,
  label,
  onChange,
  options,
  value,
}: {
  assumedLabel: string
  hint?: string
  label: string
  onChange: (value: T | undefined) => void
  options: ReadonlyArray<{ label: string; value: T }>
  value: T | undefined
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-0.5 px-1 text-xs">
      <label className="flex items-center gap-2" htmlFor={id}>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
        <select
          className="h-7 min-w-0 max-w-[60%] rounded-md border border-border/50 bg-[#232325] px-1.5 text-foreground outline-none"
          id={id}
          onChange={(event) => onChange((event.target.value || undefined) as T | undefined)}
          value={value ?? ''}
        >
          <option value="">Assumed — {assumedLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {hint && <span className="text-[10px] text-muted-foreground/70 leading-snug">{hint}</span>}
    </div>
  )
}

/**
 * A yes/no the project may not have answered.
 *
 * Three states rather than a checkbox, because every one of these booleans makes
 * the design heavier when true and the absent state is not "no" — it is "nobody
 * has said, and the engine is reading the conservative side". Collapsing that into
 * an unchecked box would report a decision the project never took.
 */
export function OptionalToggleField({
  assumed,
  hint,
  label,
  onChange,
  value,
}: {
  /** What the chain does when unset. */
  assumed: 'yes' | 'no'
  hint?: string
  label: string
  onChange: (value: boolean | undefined) => void
  value: boolean | undefined
}) {
  const options: Array<{ label: string; state: boolean | undefined }> = [
    { label: `Assumed ${assumed}`, state: undefined },
    { label: 'No', state: false },
    { label: 'Yes', state: true },
  ]
  return (
    <div className="flex flex-col gap-0.5 px-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
        <div className="flex shrink-0 items-center rounded-md border border-border/50 bg-[#2C2C2E] p-[2px]">
          {options.map((option) => (
            <button
              className={
                option.state === value
                  ? 'rounded px-1.5 py-0.5 text-[10px] text-foreground ring-1 ring-border/50 bg-[#3e3e3e]'
                  : 'rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground'
              }
              key={option.label}
              onClick={() => onChange(option.state)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {hint && <span className="text-[10px] text-muted-foreground/70 leading-snug">{hint}</span>}
    </div>
  )
}

/** A group's own explanatory line — what the fields under it actually change. */
export function GroupNote({ children }: { children: React.ReactNode }) {
  return <p className="px-1 pb-1 text-[10px] text-muted-foreground/70 leading-snug">{children}</p>
}

/**
 * What the yard owns, one catalog line at a time.
 *
 * Not an `OptionalNumberField` per catalog id, and the reason is the shape of the
 * answer rather than the length of the list. There are hundreds of ownable parts and a
 * yard owns a handful of them, so a field per id would be a wall of blanks in which
 * "assumed" is the answer everywhere and the four lines that matter are invisible. A
 * rack is a list somebody adds to.
 *
 * Recorded and *empty* is a real answer — "we own nothing, price it all as hire" — so
 * removing the last line does not clear the group. `onClear` is the separate, explicit
 * way back to unstated, which is why it is a button of its own rather than a side
 * effect of emptying the list.
 */
export function StockRackField({
  onClear,
  onSet,
  options,
  owned,
}: {
  /** Back to unstated, which is not the same as a recorded rack of nothing. */
  onClear: () => void
  /** `undefined` removes the id. */
  onSet: (catalogId: string, quantity: number | undefined) => void
  options: ReadonlyArray<{ id: string; label: string; family: string }>
  /** `undefined` where the project has recorded no rack at all. */
  owned: Readonly<Record<string, number>> | undefined
}) {
  const addId = useId()
  const byId = new Map(options.map((option) => [option.id, option]))
  const lines = Object.entries(owned ?? {}).sort(([a], [b]) =>
    (byId.get(a)?.label ?? a).localeCompare(byId.get(b)?.label ?? b),
  )
  const families = [...new Set(options.map((option) => option.family))]

  return (
    <div className="flex flex-col gap-1 px-1 text-xs">
      {owned === undefined ? (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          Nothing recorded, so the takeoff shows no owned/hired split at all — not a bill of
          everything on hire. Add a line to state what the yard holds.
        </p>
      ) : lines.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          Recorded as owning nothing, so the whole bill prices as hire. That is a stated answer;
          reset below to go back to nobody having said.
        </p>
      ) : null}

      {lines.map(([catalogId, quantity]) => (
        <div className="flex items-center gap-2" key={catalogId}>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={catalogId}>
            {byId.get(catalogId)?.label ?? catalogId}
          </span>
          <input
            aria-label={`Owned quantity, ${byId.get(catalogId)?.label ?? catalogId}`}
            className="h-7 w-16 shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-right font-mono outline-none"
            defaultValue={quantity}
            key={`${catalogId}-${quantity}`}
            min={0}
            onBlur={(event) => {
              const raw = event.currentTarget.value.trim()
              const parsed = Number.parseInt(raw, 10)
              // A blank box removes the line; a 0 is kept, because "we own none of
              // these" is a fact about a type the yard has run out of.
              if (raw === '' || !Number.isFinite(parsed) || parsed < 0) onSet(catalogId, undefined)
              else onSet(catalogId, parsed)
            }}
            step={1}
            type="number"
          />
          <button
            className="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => onSet(catalogId, undefined)}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}

      <label className="flex items-center gap-2" htmlFor={addId}>
        <span className="shrink-0 text-muted-foreground">Add</span>
        <select
          className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-[#232325] px-1.5 text-foreground outline-none"
          id={addId}
          onChange={(event) => {
            const catalogId = event.target.value
            event.currentTarget.value = ''
            // 1 rather than 0, because adding a line is the act of saying the yard has
            // some of these — a new line reading 0 would state the opposite.
            if (catalogId) onSet(catalogId, 1)
          }}
          value=""
        >
          <option value="">Choose a part…</option>
          {families.map((family) => (
            <optgroup key={family} label={family}>
              {options
                .filter((option) => option.family === family && !(option.id in (owned ?? {})))
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      {owned !== undefined && (
        <button
          className="self-start rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={onClear}
          type="button"
        >
          Back to nobody having said
        </button>
      )}
    </div>
  )
}
