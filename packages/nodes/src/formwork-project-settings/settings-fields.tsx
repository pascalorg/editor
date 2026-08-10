'use client'

import type { FormworkRateSettings, PartRate } from '@pascal-app/core'
import { useId, useState } from 'react'

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

/**
 * One figure in a rate row.
 *
 * Blank clears the field, and so does a zero — unlike the rack's quantity, where 0 is
 * the real answer "we own none of these". A part worth nothing is not a price, and
 * `PartRate` requires every figure to be positive, so a 0 typed here has to become
 * "unstated" rather than a value the schema rejects on save.
 */
function RateCell({
  label,
  max,
  onCommit,
  placeholder,
  step,
  value,
}: {
  label: string
  max?: number
  onCommit: (value: number | undefined) => void
  placeholder: string
  step: number
  value: number | undefined
}) {
  return (
    <input
      aria-label={label}
      className="h-7 w-[4.5rem] shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-1.5 text-right font-mono outline-none"
      defaultValue={value ?? ''}
      // Remount when the stored figure changes from elsewhere — the AI writing the
      // same rate, or an undo — so the box does not keep a stale draft.
      key={`${label}-${value ?? 'unset'}`}
      max={max}
      min={0}
      onBlur={(event) => {
        const raw = event.currentTarget.value.trim()
        const parsed = Number.parseFloat(raw)
        if (raw === '' || !Number.isFinite(parsed) || parsed <= 0) {
          onCommit(undefined)
          return
        }
        if (max !== undefined && parsed > max) return
        onCommit(parsed)
      }}
      placeholder={placeholder}
      step={step}
      type="number"
    />
  )
}

/**
 * What the project pays, one catalog line at a time.
 *
 * Built like `StockRackField` and for the same reason — a rate table is a short list
 * somebody adds to, not a field per catalog id — with one difference that matters: a row
 * has three figures rather than one, and they are entered at different times. A list
 * price comes off a quotation and a hire term comes out of an agreement, so each cell
 * commits on its own and the merge behind it is per *field*. Replacing the row would make
 * filling in the second figure delete the first.
 *
 * The currency sits above the list rather than in it, because it is a term of the
 * agreement and not a property of a panel — as is the minimum hire period, which is most
 * of the cost of a fast cycle and the commonest reason a hire invoice does not match a
 * programme.
 *
 * Nothing here is ever assumed. Every other control in this panel renders the shipped
 * default as placeholder text, and these render "not stated": a rate is the one input in
 * the model that no code publishes and no product carries, so there is nothing
 * conservative to fall back to — a zero prices the job at nothing and anything else
 * invents a price.
 */
export function RateTableField({
  onClear,
  onSetRate,
  onSetTerms,
  options,
  rates,
}: {
  /** Back to unstated, which is not the same as a recorded table of nothing. */
  onClear: () => void
  /** `undefined` for the whole rate removes the id; `null` for a field clears it. */
  onSetRate: (catalogId: string, patch: Record<string, number | null> | undefined) => void
  /** The agreement's own terms. `null` clears. */
  onSetTerms: (patch: { currency?: string | null; minHireDays?: number | null }) => void
  options: ReadonlyArray<{ id: string; label: string; family: string }>
  /** `undefined` where the project has recorded no rates at all. */
  rates: FormworkRateSettings | undefined
}) {
  const addId = useId()
  const currencyId = useId()
  // Rows chosen but not yet priced, held here because they cannot be stored: a rate with
  // no figures in it is dropped by the merge on purpose — there is no number that means
  // "priced, amount unknown", and a stored empty row would be an id the takeoff reports
  // as unpriced for as long as nobody noticed it. So an empty row is a half-finished
  // edit, and half-finished edits live in the component.
  const [pending, setPending] = useState<readonly string[]>([])
  const byId = new Map(options.map((option) => [option.id, option]))
  const byCatalogId: Readonly<Record<string, PartRate>> = rates?.byCatalogId ?? {}
  const lines = [
    ...Object.entries(byCatalogId),
    ...pending.filter((id) => !(id in byCatalogId)).map((id) => [id, {}] as [string, PartRate]),
  ].sort(([a], [b]) => (byId.get(a)?.label ?? a).localeCompare(byId.get(b)?.label ?? b))
  const families = [...new Set(options.map((option) => option.family))]

  return (
    <div className="flex flex-col gap-1 px-1 text-xs">
      {rates === undefined ? (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          No rates recorded, so the takeoff carries no money at all — not a job that costs nothing.
          Add a line to price one.
        </p>
      ) : lines.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          The table is open and empty, so every line reads as unpriced and the total is a floor of
          nothing. Reset below to go back to nobody having said.
        </p>
      ) : null}

      <label className="flex items-center gap-2" htmlFor={currencyId}>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Currency</span>
        <input
          className="h-7 w-[4.5rem] shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-1.5 text-right font-mono uppercase outline-none"
          defaultValue={rates?.currency ?? ''}
          id={currencyId}
          key={`currency-${rates?.currency ?? 'unset'}`}
          maxLength={3}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim().toUpperCase()
            // Refused rather than stored half-typed: the schema takes ISO 4217 only, and
            // a two-letter draft written through would fail on save with the panel still
            // showing it as recorded.
            if (raw !== '' && !/^[A-Z]{3}$/.test(raw)) return
            onSetTerms({ currency: raw === '' ? null : raw })
          }}
          placeholder="none"
          type="text"
        />
      </label>
      <label className="flex items-center gap-2" htmlFor={`${currencyId}-min`}>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Minimum hire</span>
        <input
          className="h-7 w-[4.5rem] shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-1.5 text-right font-mono outline-none"
          defaultValue={rates?.minHireDays ?? ''}
          id={`${currencyId}-min`}
          key={`min-hire-${rates?.minHireDays ?? 'unset'}`}
          min={1}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim()
            const parsed = Number.parseInt(raw, 10)
            if (raw === '' || !Number.isFinite(parsed) || parsed < 1)
              onSetTerms({ minHireDays: null })
            else onSetTerms({ minHireDays: parsed })
          }}
          placeholder="none"
          step={1}
          type="number"
        />
        <span className="w-10 shrink-0 text-muted-foreground/70">days</span>
      </label>
      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        A wall form struck in 12 hours against a 28-day minimum is charged for 28 days, so the
        minimum is most of the cost of a fast cycle — and the remedy is pouring more with the same
        set, not striking sooner.
      </p>

      {lines.length > 0 && (
        <div className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground/70">
          <span className="min-w-0 flex-1" />
          <span className="w-[4.5rem] shrink-0 text-right">List</span>
          <span className="w-[4.5rem] shrink-0 text-right">% / month</span>
          <span className="w-[4.5rem] shrink-0 text-right">Flat / month</span>
          <span className="w-12 shrink-0" />
        </div>
      )}

      {lines.map(([catalogId, rate]) => (
        <div className="flex flex-col gap-0.5" key={catalogId}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={catalogId}>
              {byId.get(catalogId)?.label ?? catalogId}
            </span>
            <RateCell
              label={`List price, ${byId.get(catalogId)?.label ?? catalogId}`}
              max={10_000_000}
              onCommit={(value) => onSetRate(catalogId, { purchasePerUnit: value ?? null })}
              placeholder="—"
              step={1}
              value={rate.purchasePerUnit}
            />
            <RateCell
              label={`Hire percent per month, ${byId.get(catalogId)?.label ?? catalogId}`}
              max={100}
              onCommit={(value) => onSetRate(catalogId, { rentalPercentPerMonth: value ?? null })}
              placeholder="—"
              step={0.5}
              value={rate.rentalPercentPerMonth}
            />
            <RateCell
              label={`Flat hire per month, ${byId.get(catalogId)?.label ?? catalogId}`}
              max={1_000_000}
              onCommit={(value) => onSetRate(catalogId, { rentalPerUnitPerMonth: value ?? null })}
              placeholder="—"
              step={1}
              value={rate.rentalPerUnitPerMonth}
            />
            <button
              className="w-12 shrink-0 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setPending((ids) => ids.filter((id) => id !== catalogId))
                onSetRate(catalogId, undefined)
              }}
              type="button"
            >
              Remove
            </button>
          </div>
          {/* Which of the two hire figures actually applies, said where both are
              entered. An actual quote beats a percentage of a list price, and a
              reader who filled in both and cannot see which one the total used has
              a figure they cannot check. */}
          {rate.rentalPerUnitPerMonth !== undefined && rate.rentalPercentPerMonth !== undefined && (
            <p className="pl-1 text-[10px] text-muted-foreground/70 leading-snug">
              The flat rate is used — a quote beats a percentage of a list price.
            </p>
          )}
          {rate.purchasePerUnit === undefined && rate.rentalPercentPerMonth !== undefined && (
            <p className="pl-1 text-[10px] text-amber-400/70 leading-snug">
              A percentage with no list price to be a percentage of. Enter the list price, or a flat
              monthly rate instead.
            </p>
          )}
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
            if (!catalogId) return
            // Adding a row is not yet a claim about money, unlike the rack where a new
            // line of 1 states the yard has some. So the row is shown and nothing is
            // written until a figure goes in — except the group itself, so that "the
            // table is open" becomes true the moment the user opens it.
            setPending((ids) => (ids.includes(catalogId) ? ids : [...ids, catalogId]))
            if (rates === undefined) onSetTerms({})
          }}
          value=""
        >
          <option value="">Choose a part…</option>
          {families.map((family) => (
            <optgroup key={family} label={family}>
              {options
                .filter(
                  (option) =>
                    option.family === family &&
                    !(option.id in byCatalogId) &&
                    !pending.includes(option.id),
                )
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      {rates !== undefined && (
        <button
          className="self-start rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => {
            setPending([])
            onClear()
          }}
          type="button"
        >
          Back to nobody having said
        </button>
      )}
    </div>
  )
}
