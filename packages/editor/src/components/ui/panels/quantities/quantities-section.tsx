'use client'

import {
  type AnyNodeId,
  priceQuantityTakeoff,
  type UnitPrice,
  unitPriceKey,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Download, FileSpreadsheet, Sigma } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { LocalizedContent } from '../../../../lib/i18n'
import {
  downloadQuantityCsv,
  formatCost,
  formatQuantity,
  takeoffForSubtree,
} from '../../../../lib/quantities'
import { downloadQuantityXlsx } from '../../../../lib/quantities-xlsx'

const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP']

/**
 * Inline unit-price editor for one takeoff line.
 *
 * Drafts the amount in local state so a keystroke does not hit the scene store
 * (and therefore the undo history) once per digit — the price is committed on
 * blur or Enter, and the currency select commits immediately when a price
 * already exists. Empty or invalid input clears the price rather than storing a
 * bogus amount that would later surface as `NaN` in a total.
 */
function LinePriceInput({ lineKey, unitPrice }: { lineKey: string; unitPrice: UnitPrice | undefined }) {
  const setUnitPrice = useScene((s) => s.setUnitPrice)
  const removeUnitPrice = useScene((s) => s.removeUnitPrice)

  const [amount, setAmount] = useState(() => (unitPrice ? String(unitPrice.amount) : ''))
  const [currency, setCurrency] = useState(() => unitPrice?.currency ?? 'TRY')

  // Reflect a price that changed elsewhere (undo, live sync, another writer).
  useEffect(() => {
    setAmount(unitPrice ? String(unitPrice.amount) : '')
    setCurrency(unitPrice?.currency ?? 'TRY')
  }, [unitPrice])

  const commit = () => {
    const raw = amount.trim()
    if (raw === '') {
      removeUnitPrice(lineKey)
      return
    }
    // Accept both the decimal comma (Turkish locale) and the dot.
    const value = Number.parseFloat(raw.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) {
      removeUnitPrice(lineKey)
      return
    }
    setUnitPrice(lineKey, { amount: value, currency })
  }

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="Currency"
        className="h-5 w-12 shrink-0 rounded border border-border/60 bg-transparent px-0.5 text-[10px] text-muted-foreground focus:outline-none"
        onChange={(event) => {
          const next = event.target.value
          setCurrency(next)
          if (unitPrice) setUnitPrice(lineKey, { amount: unitPrice.amount, currency: next })
        }}
        value={currency}
      >
        {CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <input
        aria-label="Unit price"
        className="h-5 w-16 shrink-0 rounded border border-border/60 bg-transparent px-1 text-right text-[10px] text-foreground tabular-nums placeholder:text-muted-foreground/40 focus:outline-none"
        inputMode="decimal"
        onBlur={commit}
        onChange={(event) => setAmount(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
        placeholder="0.00"
        value={amount}
      />
    </div>
  )
}

/**
 * Live quantity takeoff for the active level.
 *
 * Recomputes whenever the scene changes, which is the point — a takeoff that
 * only exists at export time cannot inform a design decision. The work is a
 * subtree walk plus each kind's own arithmetic, so it stays cheap enough to run
 * on edit; if a scene ever outgrows that, `dirtyNodes` is the incremental hook.
 */
export function QuantitiesSection() {
  const levelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  // The whole point is liveness, so subscribe to the node map itself.
  const nodes = useScene((state) => state.nodes)
  const unitPrices = useScene((state) => state.unitPrices)

  const takeoff = useMemo(
    () => (levelId ? takeoffForSubtree(levelId as AnyNodeId) : null),
    // `nodes` is the change signal; `takeoffForSubtree` reads the store itself.
    [levelId, nodes],
  )

  const priced = useMemo(
    () => (takeoff ? priceQuantityTakeoff(takeoff, unitPrices) : null),
    [takeoff, unitPrices],
  )

  const hasRows = (takeoff?.sections.length ?? 0) > 0
  const hasTotals = (priced?.totals.length ?? 0) > 0

  return (
    <LocalizedContent>
      <div className="flex flex-col border-border/40 border-b">
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
          <Sigma className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold text-muted-foreground text-xs tracking-tight">
            Quantities
          </span>
          <button
            aria-label="Export quantities as CSV"
            className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
            disabled={!(takeoff && hasRows)}
            onClick={() => takeoff && downloadQuantityCsv(takeoff)}
            title="Export CSV"
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label="Export quantities as XLSX"
            className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
            disabled={!(priced && hasRows)}
            onClick={() => priced && downloadQuantityXlsx(priced)}
            title="Export XLSX"
            type="button"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
          </button>
        </div>

        {!levelId ? (
          <p className="px-3 pb-2.5 text-[11px] text-muted-foreground/60">
            Select a level to measure it.
          </p>
        ) : !hasRows ? (
          <p className="px-3 pb-2.5 text-[11px] text-muted-foreground/60">
            Nothing to measure on this level yet.
          </p>
        ) : (
          <div className="flex flex-col pb-2">
            {priced?.sections.map((section) => (
              <div className="flex flex-col" key={section.kind}>
                <div className="flex items-baseline gap-1.5 px-3 pt-1.5 pb-0.5">
                  <span className="font-medium text-[11px] text-foreground">{section.label}</span>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {section.lines[0]?.nodeCount ?? 0}
                  </span>
                </div>
                {section.lines.map((line) => {
                  const cost =
                    line.unitPrice && line.cost !== undefined
                      ? formatCost(line.cost, line.unitPrice.currency)
                      : '—'
                  return (
                    <div className="flex flex-col px-3 py-0.5" key={`${line.key}-${line.group ?? ''}`}>
                      <div className="flex items-baseline gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {line.group ? `${line.group} · ${line.label}` : line.label}
                        </span>
                        <span className="shrink-0 text-foreground tabular-nums">
                          {formatQuantity(line.value, line.unit, unit, metricNotation)}
                        </span>
                      </div>
                      <div className="flex items-center justify-end gap-1.5 pt-0.5">
                        <LinePriceInput
                          lineKey={unitPriceKey(section.kind, line.key, line.group)}
                          unitPrice={line.unitPrice}
                        />
                        <span className="w-20 shrink-0 text-right text-[10px] text-foreground tabular-nums">
                          {cost}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            {hasTotals && (
              <div className="mt-1 border-border/40 border-t">
                {priced?.totals.map((total) => (
                  <div
                    className="flex items-baseline justify-between px-3 py-0.5 text-[11px]"
                    key={total.currency}
                  >
                    <span className="font-medium text-muted-foreground">Total</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatCost(total.cost, total.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </LocalizedContent>
  )
}
