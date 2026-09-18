'use client'

import { useSyncExternalStore } from 'react'
import type { PanelRow } from '../../../lib/panel-rows'
import { PanelSection } from './panel-section'
import { SliderControl } from './slider-control'

function Row({ row }: { row: PanelRow }) {
  if (row.kind === 'subscribed-choice') return <SubscribedRow row={row} />
  if (row.kind === 'stepper') return <SliderControl label={row.label} min={row.min} max={row.max} step={row.step}
    precision={Math.max(0, Math.ceil(-Math.log10(row.step)))}
    value={row.value} unit={row.unit} onChange={row.onChange} />
  if (row.kind === 'actions') return <div className="flex gap-2">{row.actions.map((action) => <Row key={action.id} row={{ ...action, kind: 'action' }} />)}</div>
  if (row.kind === 'cycle') return <div className="flex items-center justify-between gap-2 py-2 text-xs">
    <span>{row.label}</span><button type="button" onClick={row.previous} aria-label={`Previous ${row.label}`}>‹</button>
    <span>{row.value}</span><button type="button" onClick={row.next} aria-label={`Next ${row.label}`}>›</button>
  </div>
  return <button type="button" disabled={!row.onSelect || (row.kind === 'action' && row.disabled)} onClick={row.onSelect}
    className="flex w-full items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs disabled:opacity-50">
    {row.kind === 'action' && row.icon?.src && <img alt="" src={row.icon.src} className="size-5 object-contain" />}
    <span>{row.label}</span>{row.kind === 'choice' && <span>{row.value}</span>}
  </button>
}

function SubscribedRow({ row }: { row: Extract<PanelRow, { kind: 'subscribed-choice' }> }) {
  const value = useSyncExternalStore(row.subscribe, row.getValue, row.getValue)
  return <Row row={{ ...row, kind: 'choice', value }} />
}

export function PanelRows({ rows }: { rows: PanelRow[] }) {
  const groups = new Map<string, PanelRow[]>()
  for (const row of rows) {
    const section = row.section ?? 'Properties'
    groups.set(section, [...(groups.get(section) ?? []), row])
  }
  return <>{[...groups].map(([section, controls]) => <PanelSection key={section} title={section}>
    {controls.map((row) => <Row key={row.id} row={row} />)}
  </PanelSection>)}</>
}
