'use client'

import {
  type AnyNodeId,
  type CollectionId,
  type Control,
  type ControlValue,
  type ItemNode,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'

// ─── Shared control derivation ───────────────────────────────────────────────

type ItemControlRef = { itemId: AnyNodeId; controlIndex: number }

type SharedControlDef = {
  kind: 'toggle' | 'slider' | 'temperature'
  label?: string
  min?: number
  max?: number
  step?: number
  unit?: string
  refs: ItemControlRef[]
}

function deriveSharedControls(items: ItemNode[]): SharedControlDef[] {
  if (items.length === 0) return []
  const result: SharedControlDef[] = []

  for (const kind of ['toggle', 'slider', 'temperature'] as const) {
    const refs: ItemControlRef[] = []
    let ref: Control | null = null
    let allHave = true

    for (const item of items) {
      const idx = item.asset.interactive!.controls.findIndex((c) => c.kind === kind)
      if (idx === -1) { allHave = false; break }
      refs.push({ itemId: item.id, controlIndex: idx })
      if (!ref) ref = item.asset.interactive!.controls[idx]!
    }

    if (!allHave || !ref) continue

    const def: SharedControlDef = { kind, label: ref.label, refs }
    if ('min' in ref) { def.min = ref.min; def.max = ref.max }
    if ('step' in ref) def.step = (ref as { step?: number }).step
    if ('unit' in ref) def.unit = (ref as { unit?: string }).unit
    result.push(def)
  }

  return result
}

// ─── Shared control widget ───────────────────────────────────────────────────

function SharedWidget({ def, value, onChange }: { def: SharedControlDef; value: ControlValue; onChange: (v: ControlValue) => void }) {
  if (def.kind === 'toggle') {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'flex h-7 w-full items-center justify-center rounded-md px-3 text-xs font-medium transition-colors',
          value ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-muted-foreground hover:text-foreground',
        )}
      >
        {def.label ?? (value ? 'On' : 'Off')}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{def.label ?? def.kind}</span>
        <span>{value}{def.kind === 'temperature' ? '°' : ''}{def.unit ? ` ${def.unit}` : ''}</span>
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step ?? 1}
        value={value as number}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full accent-white"
      />
    </div>
  )
}

// ─── Individual item control widget ──────────────────────────────────────────

function ItemWidget({ control, value, onChange }: { control: Control; value: ControlValue; onChange: (v: ControlValue) => void }) {
  if (control.kind === 'toggle') {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'flex h-6 w-full items-center justify-center rounded px-2 text-[10px] font-medium transition-colors',
          value ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-muted-foreground hover:text-foreground',
        )}
      >
        {control.label ?? (value ? 'On' : 'Off')}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{control.label ?? control.kind}</span>
        <span>{value}{control.kind === 'temperature' ? '°' : ''}{'unit' in control && control.unit ? ` ${control.unit}` : ''}</span>
      </div>
      <input
        type="range"
        min={'min' in control ? control.min : 0}
        max={'max' in control ? control.max : 100}
        step={'step' in control ? (control as { step?: number }).step ?? 1 : 1}
        value={value as number}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full accent-white"
      />
    </div>
  )
}

// ─── Collection row ───────────────────────────────────────────────────────────

function CollectionRow({ collectionId }: { collectionId: CollectionId }) {
  const collection = useScene((s) => s.collections[collectionId])

  const interactiveItems = useScene(
    useShallow((s) =>
      (collection?.nodeIds ?? [])
        .map((id) => s.nodes[id])
        .filter((n): n is ItemNode => n?.type === 'item' && !!n.asset.interactive)
    ),
  )

  const controlValuesByItem = useInteractive(
    useShallow((s) =>
      Object.fromEntries(interactiveItems.map((n) => [n.id, s.items[n.id]?.controlValues ?? []])),
    ),
  )

  const setControlValue = useInteractive((s) => s.setControlValue)

  const [expanded, setExpanded] = useState(false)
  const [expandedItemIds, setExpandedItemIds] = useState<Set<AnyNodeId>>(new Set())

  if (!collection) return null

  const sharedControls = deriveSharedControls(interactiveItems)

  const getSharedValue = (def: SharedControlDef): ControlValue => {
    if (def.kind === 'toggle') {
      return def.refs.every(({ itemId, controlIndex }) => Boolean(controlValuesByItem[itemId]?.[controlIndex]))
    }
    const first = def.refs[0]!
    return controlValuesByItem[first.itemId]?.[first.controlIndex] ?? 0
  }

  const setSharedValue = (def: SharedControlDef, value: ControlValue) => {
    for (const { itemId, controlIndex } of def.refs) {
      setControlValue(itemId, controlIndex, value)
    }
  }

  const toggleItemExpand = (id: AnyNodeId) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/20"
          style={{ backgroundColor: collection.color ?? '#6366f1' }}
        />
        <span className="flex-1 min-w-0 text-xs font-medium text-foreground truncate text-left">
          {collection.name}
        </span>
        {interactiveItems.length > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {interactiveItems.length}
          </span>
        )}
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="pb-1">
          {interactiveItems.length === 0 ? (
            <p className="px-3 pb-2 text-[11px] text-muted-foreground">No interactive items.</p>
          ) : (
            <>
              {/* Shared controls */}
              {sharedControls.length > 0 && (
                <div className="px-3 pt-0.5 pb-2.5 border-b border-border/30">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">All</p>
                  <div className="flex flex-col gap-2">
                    {sharedControls.map((def, i) => (
                      <SharedWidget
                        key={i}
                        def={def}
                        value={getSharedValue(def)}
                        onChange={(v) => setSharedValue(def, v)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Individual items */}
              {interactiveItems.map((item) => {
                const isItemExpanded = expandedItemIds.has(item.id)
                const controls = item.asset.interactive!.controls
                const values = controlValuesByItem[item.id] ?? []

                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      onClick={() => toggleItemExpand(item.id)}
                      className="flex w-full items-center gap-1.5 px-3 py-1.5 hover:bg-white/5 transition-colors"
                    >
                      {isItemExpanded
                        ? <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
                        : <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />}
                      <span className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate text-left">
                        {item.name || item.asset.name}
                      </span>
                    </button>

                    {isItemExpanded && (
                      <div className="px-3 pb-2 flex flex-col gap-1.5">
                        {controls.map((control, i) => (
                          <ItemWidget
                            key={i}
                            control={control}
                            value={values[i] ?? false}
                            onChange={(v) => setControlValue(item.id, i, v)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function CollectionsPanel() {
  const collectionIds = useScene(
    useShallow((s) => Object.keys(s.collections) as CollectionId[]),
  )

  if (collectionIds.length === 0) return null

  return (
    <div className="pointer-events-auto flex flex-col rounded-2xl border border-border/40 bg-background/95 shadow-lg backdrop-blur-xl overflow-hidden w-56">
      <div className="px-3 py-2 border-b border-border/40 shrink-0">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Collections</span>
      </div>
      <div className="overflow-y-auto max-h-[70vh] no-scrollbar divide-y divide-border/30">
        {collectionIds.map((id) => (
          <CollectionRow key={id} collectionId={id} />
        ))}
      </div>
    </div>
  )
}
