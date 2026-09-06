'use client'

/**
 * The address box: type an address (with keyless autocomplete) or pick a
 * preset lot, press the button, the lot drops in. Used by the Lot panel and
 * embedded at the top of the Generate panel with a different button label.
 */
import { type DropInInput, dropInLot, type LotDropInResult } from '@pascal-app/editor'
import { MapPin, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PRESET_LOTS, presetDropInInput } from './presets'
import { type Suggestion, useLot } from './store'

const field =
  'w-full rounded-md border border-sidebar-border/60 bg-sidebar px-2 py-1.5 text-xs text-sidebar-foreground'
const label = 'mb-1 block font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider'

/** The drop-in input for the box's current state. */
export function currentDropInInput(): DropInInput | null {
  const S = useLot.getState()
  const preset = PRESET_LOTS[S.preset]
  if (preset) return presetDropInInput(preset)
  const address = S.query.trim()
  if (!address) return null
  const p = S.picked
  return {
    address,
    ...(p?.lat != null && p?.lng != null
      ? { latitude: p.lat, longitude: p.lng, state: p.state }
      : {}),
    street: p?.line1,
    city: p?.city,
    zip: p?.postcode,
  }
}

/** Run the drop-in from the box's state; the result lands in the store. */
export async function runDropIn(): Promise<LotDropInResult | null> {
  const S = useLot.getState()
  if (S.busy) return null
  const input = currentDropInInput()
  if (!input) {
    S.setStatus('Type an address or pick a preset lot first.')
    return null
  }
  S.setBusy(true)
  S.setStatus('Looking up the parcel and the streets around it…')
  try {
    const result = await dropInLot(input)
    useLot.getState().setLast(result)
    useLot.getState().setStatus(result.message)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lot drop-in failed.'
    useLot.getState().setStatus(message)
    return { ok: false, error: message, message }
  } finally {
    useLot.getState().setBusy(false)
  }
}

export function LotAddressBox({
  buttonLabel = 'Drop in lot',
  onDone,
}: {
  buttonLabel?: string
  onDone?: (result: LotDropInResult) => void | Promise<void>
}) {
  const S = useLot()
  const requestSeq = useRef(0)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  // Debounced keyless autocomplete; `seq` drops an earlier answer landing late.
  useEffect(() => {
    const q = S.query.trim()
    if (q.length < 4 || S.picked || S.preset >= 0) {
      setSuggestions([])
      return
    }
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      fetch(`/api/parcel/autocomplete?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: { suggestions?: Suggestion[] }) => {
          if (seq !== requestSeq.current) return
          setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
        })
        .catch(() => {
          if (seq === requestSeq.current) setSuggestions([])
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [S.query, S.picked, S.preset])

  const run = async () => {
    const result = await runDropIn()
    if (result && onDone) await onDone(result)
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className={label}>Address</span>
        <input
          className={field}
          onChange={(e) => {
            S.setQuery(e.target.value)
            S.setPicked(null)
            if (S.preset >= 0) S.setPreset(-1)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="1200 W Cass St, Tampa, FL"
          value={S.query}
        />
        {suggestions.length > 0 ? (
          <ul className="mt-1 max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-sidebar-border/60 bg-sidebar p-1">
            {suggestions.map((s) => (
              <li key={`${s.label}-${s.lat}-${s.lng}`}>
                <button
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent"
                  onClick={() => {
                    S.setPicked(s)
                    S.setQuery(s.label ?? [s.line1, s.line2].filter(Boolean).join(', '))
                    setSuggestions([])
                  }}
                  type="button"
                >
                  <MapPin className="mt-0.5 size-3 shrink-0 text-sidebar-foreground/60" />
                  <span>{s.label ?? [s.line1, s.line2].filter(Boolean).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div>
        <span className={label}>Or a preset lot</span>
        <select
          className={field}
          onChange={(e) => {
            const i = Number(e.target.value)
            S.setPreset(i)
            S.setPicked(null)
            const p = PRESET_LOTS[i]
            S.setQuery(p ? `${p.address1}, ${p.address2}` : '')
          }}
          value={S.preset}
        >
          <option value={-1}>typed address</option>
          {PRESET_LOTS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.badge} {p.label} — {p.lotNote}
            </option>
          ))}
        </select>
      </div>
      <button
        className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground text-xs shadow-sm disabled:opacity-60"
        disabled={S.busy}
        onClick={() => void run()}
        type="button"
      >
        <Search className="h-3.5 w-3.5" />
        {S.busy ? 'Dropping in…' : buttonLabel}
      </button>
      {S.status ? (
        <p className="text-[11px] text-sidebar-foreground/70 leading-snug">{S.status}</p>
      ) : null}
    </div>
  )
}
