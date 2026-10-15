'use client'

import { useId, useState } from 'react'
import { KITCHEN_ITEMS, kitchenItemMatches } from './kitchen-catalog'
import useCabinetPlacementStatus from './placement-status'
import type { CabinetPresetId } from './presets'

export function KitchenThumbnail({ id }: { id: CabinetPresetId }) {
  return (
    <img
      src={`/icons/kitchen/${id}.webp`}
      alt=""
      aria-hidden="true"
      width={256}
      height={256}
      loading="lazy"
      decoding="async"
      draggable={false}
      className="h-20 w-full object-contain"
    />
  )
}

export function KitchenCollection({
  onSelect,
  activeId,
  query,
  includeWall = true,
}: {
  onSelect: (id: CabinetPresetId) => void
  activeId?: CabinetPresetId | null
  query?: string
  includeWall?: boolean
}) {
  const [search, setSearch] = useState('')
  const placementTarget = useCabinetPlacementStatus((state) => state.target)
  const inputId = useId()
  const items = KITCHEN_ITEMS.filter(
    (item) =>
      (includeWall || item.id !== 'wall-cabinet') && kitchenItemMatches(item.id, query ?? search),
  )
  return (
    <div className="space-y-3">
      {placementTarget && (
        <p
          role="status"
          className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs"
        >
          {placementTarget}
        </p>
      )}
      {query === undefined && (
        <div>
          <label htmlFor={inputId} className="sr-only">
            Search kitchen items
          </label>
          <input
            id={inputId}
            type="search"
            placeholder="Search fridge, sink, cabinets…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
      {(['Cabinets', 'Appliances & fixtures'] as const).map((group) => {
        const entries = items.filter((item) => item.group === group)
        return (
          entries.length > 0 && (
            <div key={group} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{group}</div>
              <div className="grid grid-cols-2 gap-2">
                {entries.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Choose ${item.label}`}
                    aria-pressed={activeId === item.id}
                    onClick={() => onSelect(item.id)}
                    className={`rounded-xl border p-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeId === item.id ? 'border-primary bg-primary/10' : 'border-border/60 bg-muted/20'}`}
                  >
                    <KitchenThumbnail id={item.id} />
                    <span className="block text-xs font-medium">{item.label}</span>
                    <span className="block pt-0.5 text-[10px] text-muted-foreground">
                      {item.group === 'Appliances & fixtures'
                        ? 'With cabinetry'
                        : item.id === 'wall-cabinet'
                          ? 'Wall mounted'
                          : 'Kitchen storage'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )
        )
      })}
      {!items.length && (
        <p role="status" className="text-xs text-muted-foreground">
          No kitchen items match. Try “fridge”, “sink”, or “cabinet”.
        </p>
      )}
    </div>
  )
}
