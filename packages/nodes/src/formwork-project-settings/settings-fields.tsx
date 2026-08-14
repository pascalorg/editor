'use client'

import type {
  FormworkLabourSettings,
  FormworkRateSettings,
  LabourNormEntry,
  PartRate,
} from '@pascal-app/core'
import { PART_KIND_LABELS } from '@pascal-app/core/formwork'
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
 *
 * Omitting `assumed` is a different claim from naming a conservative figure: it says
 * nothing is assumed here at all, so the field reads "not stated" rather than
 * "assumed nothing". A lead time is the case — there is no published table behind it
 * and a zero would say the shutter appears on the morning of the pour.
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
  /** What the chain uses when this is unset, already formatted. Absent where nothing is. */
  assumed?: string
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
          placeholder={assumed ?? 'not stated'}
          step={step}
          type="number"
        />
        {unit && <span className="w-10 shrink-0 text-muted-foreground/70">{unit}</span>}
      </div>
      <span className="text-[10px] text-muted-foreground/70 leading-snug">
        {value === undefined && assumed !== undefined
          ? `Assumed ${assumed}${unit ? ` ${unit}` : ''}. `
          : ''}
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
  options: ReadonlyArray<{ label: string; value: T; disabled?: boolean }>
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
            <option disabled={option.disabled} key={option.value} value={option.value}>
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
  onSetTerms: (patch: {
    currency?: string | null
    minHireDays?: number | null
    financeRatePerAnnum?: number | null
  }) => void
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
      <label className="flex items-center gap-2" htmlFor={`${currencyId}-finance`}>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Finance</span>
        <input
          className="h-7 w-[4.5rem] shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-1.5 text-right font-mono outline-none"
          defaultValue={rates?.financeRatePerAnnum ?? ''}
          id={`${currencyId}-finance`}
          key={`finance-${rates?.financeRatePerAnnum ?? 'unset'}`}
          min={0}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim()
            const parsed = Number.parseFloat(raw)
            if (raw === '' || !Number.isFinite(parsed) || parsed < 0)
              onSetTerms({ financeRatePerAnnum: null })
            else onSetTerms({ financeRatePerAnnum: parsed })
          }}
          placeholder="none"
          step={0.5}
          type="number"
        />
        <span className="w-10 shrink-0 text-muted-foreground/70">%/yr</span>
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
          <span className="w-[4.5rem] shrink-0 text-right">Uses</span>
          <span className="w-[4.5rem] shrink-0 text-right">Residual</span>
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
            <RateCell
              label={`Expected uses, ${byId.get(catalogId)?.label ?? catalogId}`}
              max={10_000}
              onCommit={(value) => onSetRate(catalogId, { expectedUses: value ?? null })}
              placeholder="—"
              step={10}
              value={rate.expectedUses}
            />
            <RateCell
              label={`Residual value, ${byId.get(catalogId)?.label ?? catalogId}`}
              max={10_000_000}
              onCommit={(value) => onSetRate(catalogId, { residualPerUnit: value ?? null })}
              placeholder="—"
              step={1}
              value={rate.residualPerUnit}
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
          {/* Which basis the yard's own stock on this line is charged on. A life changes the
              figure from a transfer price to a share of a purchase, and a reader who entered
              a life expecting the hire figure to stay put has a number they did not intend. */}
          {rate.expectedUses !== undefined && rate.purchasePerUnit !== undefined && (
            <p className="pl-1 text-[10px] text-muted-foreground/70 leading-snug">
              Own stock on this line is amortised, not recharged:{' '}
              {(
                (rate.purchasePerUnit - Math.min(rate.residualPerUnit ?? 0, rate.purchasePerUnit)) /
                rate.expectedUses
              ).toFixed(2)}{' '}
              per fitting.
            </p>
          )}
          {rate.expectedUses !== undefined && rate.purchasePerUnit === undefined && (
            <p className="pl-1 text-[10px] text-amber-400/70 leading-snug">
              A life with no list price to spread over it. Own stock stays on the internal hire rate
              until a list price is entered.
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

/**
 * Which sheets the yard buys, in preference order.
 *
 * A list rather than one select, because a yard that stocks a 1500 × 3000 beside its
 * 1220 × 2440 buys fewer sheets than one restricted to either: the nest opens the big
 * sheet for the few boards that need it. The order is the preference and it is the order
 * the lines are shown in, not alphabetical — a nest tries the first sheet first, so a
 * reordered list is a different sheet count and a list sorted for display would hide it.
 *
 * Nothing here is assumed, and this is a case the rates' reasoning does not quite cover:
 * the catalog does hold seven sheets, so a default was available and is still wrong.
 * Nesting against all seven answers for a merchant rather than for this job, and picking
 * one is a supply decision taken on the project's behalf.
 */
export function SheetStockField({
  onSet,
  options,
  stockIds,
}: {
  /** The whole list, in preference order. `undefined` hands the field back to unstated. */
  onSet: (ids: string[] | undefined) => void
  options: ReadonlyArray<{ id: string; label: string }>
  /** `undefined` where the project has recorded no sheet at all. */
  stockIds: readonly string[] | undefined
}) {
  const addId = useId()
  const byId = new Map(options.map((option) => [option.id, option]))
  const lines = stockIds ?? []

  return (
    <div className="flex flex-col gap-1 px-1 text-xs">
      {lines.length === 0 && (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          No sheet recorded, so the takeoff carries no cut list at all — the cut boards are still
          billed and priced, and nothing says how many sheets to buy them out of. Add the sheet the
          yard buys.
        </p>
      )}

      {lines.map((id, index) => (
        <div className="flex items-center gap-2" key={id}>
          <span className="shrink-0 font-mono text-muted-foreground/70">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={id}>
            {byId.get(id)?.label ?? id}
          </span>
          {/* Reordering is an edit rather than a display preference, because the nest tries
              the first sheet first — so moving one up is what makes a big sheet the one the
              wide boards come out of. */}
          <button
            aria-label={`Move ${byId.get(id)?.label ?? id} up the preference order`}
            className="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={index === 0}
            onClick={() => {
              const next = [...lines]
              const above = next[index - 1] as string
              next[index - 1] = id
              next[index] = above
              onSet(next)
            }}
            type="button"
          >
            Up
          </button>
          <button
            className="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              const next = lines.filter((entry) => entry !== id)
              // Back to unstated on the last line, rather than to a stated empty list: a
              // list of no sheets and nobody having said are the same claim, and only one
              // of them should be reachable.
              onSet(next.length === 0 ? undefined : next)
            }}
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
            const id = event.target.value
            event.currentTarget.value = ''
            if (id) onSet([...lines, id])
          }}
          value=""
        >
          <option value="">Choose a sheet…</option>
          {options
            .filter((option) => !lines.includes(option.id))
            .map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
        </select>
      </label>

      {lines.length > 0 && (
        <button
          className="self-start rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => onSet(undefined)}
          type="button"
        >
          Back to nobody having said
        </button>
      )}
    </div>
  )
}

/**
 * The kinds a norm can be stated against, in the order a bill lists them.
 *
 * A fixed list rather than a picker, unlike the rack and the rate table: there are twelve
 * kinds against hundreds of catalog ids, and every one of them is in every bill this
 * engine produces. So an unfilled row here is a real gap in an answer the user is about to
 * read, and hiding it behind a dropdown is how a table gets left half-filled.
 */
const NORM_KINDS = [
  'panel',
  'filler',
  'corner',
  'stop-end',
  'ply-piece',
  'waler',
  'joist',
  'tie',
  'prop',
  'brace',
  'accessory',
] as const

/**
 * This project's own output norms, per kind of part, and what an hour of the gang costs.
 *
 * The strictest field in this panel about assuming nothing, and stricter than the rates
 * for a reason worth stating in the UI itself: a price at least has a market, and an
 * output norm is a fact about *this* crew. The published constants — CPWD's carpenter and
 * mazdoor days per 10 m², Spon's and RSMeans hours per m² — are per m² of a whole trade
 * operation that already contains the panels, the backing, the ties and the strike, so
 * none of them can be spread over a bill of parts. So no placeholder here is ever a
 * figure: every empty cell reads "—", and an unfilled kind shows on the takeoff as
 * fittings the answer does not cover.
 *
 * `consumable` is deliberately not in the list. A drum of release agent is measured in
 * litres and an hours-per-fitting norm has no meaning against a litre — the takeoff
 * reports those lines rather than multiplying them, so a row here could only be a figure
 * nothing would ever use.
 */
export function LabourNormField({
  gangRatePerHour,
  currency,
  labour,
  onClear,
  onSetGangRate,
  onSetNorm,
}: {
  /** From `rates`, where the money and its currency live. */
  gangRatePerHour: number | undefined
  currency: string | undefined
  /** `undefined` where the project has stated no norms at all. */
  labour: FormworkLabourSettings | undefined
  /** Back to unstated, which takes the hours off the takeoff entirely. */
  onClear: () => void
  /** `null` clears the rate, leaving hours with no money against them. */
  onSetGangRate: (value: number | null) => void
  /** `null` for a field clears just that figure. */
  onSetNorm: (kind: string, patch: Record<string, number | null>) => void
}) {
  const rateId = useId()
  const byPartKind: Readonly<Record<string, LabourNormEntry>> = labour?.byPartKind ?? {}
  const stated = NORM_KINDS.filter((kind) => {
    const norm = byPartKind[kind]
    return norm !== undefined && (norm.erectHours !== undefined || norm.strikeHours !== undefined)
  })

  return (
    <div className="flex flex-col gap-1 px-1 text-xs">
      {labour === undefined ? (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          No norms recorded, so the takeoff carries no labour at all — not a job with no labour in
          it. Enter the hours your gang takes and every kind of part in the bill costs out.
        </p>
      ) : stated.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          The table is open and empty, so every fitting reads as unnormed and the hours total is a
          floor of nothing. Reset below to go back to nobody having said.
        </p>
      ) : (
        stated.length < NORM_KINDS.length && (
          <p className="text-[10px] text-amber-400/70 leading-snug">
            {NORM_KINDS.length - stated.length} of {NORM_KINDS.length} kinds carry no norm, so the
            takeoff's hours are a floor and short by every fitting of those kinds.
          </p>
        )
      )}

      <label className="flex items-center gap-2" htmlFor={rateId}>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          Gang rate{currency === undefined ? '' : ` (${currency})`}
        </span>
        <input
          aria-label="Gang rate per man-hour"
          className="h-7 w-[4.5rem] shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-1.5 text-right font-mono outline-none"
          defaultValue={gangRatePerHour ?? ''}
          id={rateId}
          key={`gang-rate-${gangRatePerHour ?? 'unset'}`}
          min={0}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim()
            const parsed = Number.parseFloat(raw)
            if (raw === '' || !Number.isFinite(parsed) || parsed <= 0) onSetGangRate(null)
            else onSetGangRate(parsed)
          }}
          placeholder="—"
          step={0.5}
          type="number"
        />
        <span className="w-12 shrink-0 text-muted-foreground/70">/ h</span>
      </label>
      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        All-in per man-hour, and it lives with the rates because it is money in the project's
        currency. Without it the takeoff reports hours with no cost against them rather than costing
        them at nothing.
      </p>

      <div className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground/70">
        <span className="min-w-0 flex-1" />
        <span className="w-[4.5rem] shrink-0 text-right">Erect h</span>
        <span className="w-[4.5rem] shrink-0 text-right">Strike h</span>
      </div>

      {NORM_KINDS.map((kind) => {
        const norm = byPartKind[kind] ?? {}
        return (
          <div className="flex flex-col gap-0.5" key={kind}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {PART_KIND_LABELS[kind]}
              </span>
              <RateCell
                label={`Erect man-hours, ${PART_KIND_LABELS[kind]}`}
                max={100}
                onCommit={(value) => onSetNorm(kind, { erectHours: value ?? null })}
                placeholder="—"
                step={0.05}
                value={norm.erectHours}
              />
              <RateCell
                label={`Strike man-hours, ${PART_KIND_LABELS[kind]}`}
                max={100}
                onCommit={(value) => onSetNorm(kind, { strikeHours: value ?? null })}
                placeholder="—"
                step={0.05}
                value={norm.strikeHours}
              />
            </div>
            {/* Half a two-part operation, said on the row rather than only on the takeoff:
                the total counts the half that is stated, so the row looks priced. */}
            {(norm.erectHours === undefined) !== (norm.strikeHours === undefined) && (
              <p className="pl-1 text-[10px] text-amber-400/70 leading-snug">
                Half the operation. Striking is not the erect reversed, so the other figure is not
                derived from this one — the takeoff counts only what is here.
              </p>
            )}
          </div>
        )
      })}

      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        Hours per fitting, so a panel fitted on three pours is counted three times — that is what a
        gang is paid for, and it is not the number of panels standing at once. Erecting and striking
        only: no cleaning, no moving the set between pours, no setting out, no waiting on concrete,
        and no learning curve on the first use of a system.
      </p>

      {labour !== undefined && (
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
 * The elevations a lift joint is allowed to land on.
 *
 * A list rather than one number, because an element is usually split once a storey:
 * the undersides of slabs and beams, the tops of slabs, and the storey breaks a lift
 * may stop on all go in the same list, and every one of them is a place the solver
 * can legitimately cut. Nothing is assumed, for the rates' reason and one sharper:
 * a default of "anywhere" is what the solver already does, and stating it would make
 * the "no permitted joint satisfies the limits" conflict impossible to reach.
 *
 * The list is edited one line at a time, like the rack — adding a joint must not
 * forget the ones already stated, which is exactly the case the group merge would
 * lose. Order is not significant here (the splitter picks the nearest in reach),
 * unlike the sheet stock where the order is the preference, so lines are shown as
 * stated rather than sorted.
 */
export function PermittedJointsField({
  elevations,
  onSet,
}: {
  /** The stated elevations in metres. `undefined` means nobody has said. */
  elevations: readonly number[] | undefined
  /** The whole list. `undefined` hands the field back to unstated. */
  onSet: (elevations: number[] | undefined) => void
}) {
  const addId = useId()
  const lines = elevations ?? []

  return (
    <div className="flex flex-col gap-1 px-1 text-xs">
      {lines.length === 0 && (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          No permitted joint stated, so every lift boundary is the solver's own uniform cut,
          labelled solver-chosen rather than as a project decision. Add the slab and beam
          undersides, the slab tops and the storey breaks a lift may stop on.
        </p>
      )}

      {lines.map((elevation, index) => (
        <div className="flex items-center gap-2" key={`${elevation}-${index}`}>
          <span className="shrink-0 font-mono text-muted-foreground/70">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
            {elevation}
          </span>
          <span className="w-6 shrink-0 text-muted-foreground/70">m</span>
          <button
            className="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              const next = lines.filter((entry) => entry !== elevation)
              // Back to unstated on the last line, rather than to a stated empty list: a
              // list of no joints and nobody having said are the same claim.
              onSet(next.length === 0 ? undefined : next)
            }}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}

      <label className="flex items-center gap-2" htmlFor={addId}>
        <span className="shrink-0 text-muted-foreground">Add</span>
        <input
          className="h-7 w-20 shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-right font-mono outline-none"
          id={addId}
          max={200}
          min={0.01}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim()
            const parsed = Number.parseFloat(raw)
            if (raw === '' || !Number.isFinite(parsed)) return
            if (parsed <= 0 || parsed > 200) return
            if (lines.includes(parsed)) return
            event.currentTarget.value = ''
            onSet([...lines, parsed])
          }}
          placeholder="m above base"
          step={0.1}
          type="number"
        />
      </label>

      {lines.length > 0 && (
        <button
          className="self-start rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => onSet(undefined)}
          type="button"
        >
          Back to nobody having said
        </button>
      )}
    </div>
  )
}
