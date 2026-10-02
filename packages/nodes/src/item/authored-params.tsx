'use client'

import type {
  GeometryScriptParamSpec,
  GeometryScriptParamValue,
  ScriptedNode,
} from '@pascal-app/core'
import {
  PanelSection,
  rebuildAuthoredObject,
  SegmentedControl,
  SliderControl,
  ToggleControl,
} from '@pascal-app/editor'
import { useState } from 'react'

/**
 * The params an authored object's script declares, as controls. Sliders
 * preview their value while dragging and rebuild on release (a rebuild runs
 * the script again: tens to hundreds of milliseconds).
 */
export function AuthoredParams({
  node,
}: {
  node: { id: string; source?: ScriptedNode['source'] }
}) {
  const source = node.source
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!source || source.manifest.params.length === 0) return null

  const rebuild = (id: string, value: GeometryScriptParamValue) => {
    setBusy(true)
    setError(null)
    rebuildAuthoredObject(node.id, { ...source.params, [id]: value })
      .catch((reason: unknown) => {
        console.error('[authored object] rebuild failed', reason)
        setError("Couldn't rebuild with these values.")
      })
      .finally(() => {
        setBusy(false)
        setDrafts((current) => {
          const { [id]: _, ...rest } = current
          return rest
        })
      })
  }

  const control = (spec: GeometryScriptParamSpec) => {
    const value = source.params[spec.id] ?? spec.default
    const label = spec.label ?? spec.id
    if (spec.kind === 'boolean') {
      return (
        <ToggleControl
          checked={Boolean(value)}
          key={spec.id}
          label={label}
          onChange={(checked) => rebuild(spec.id, checked)}
        />
      )
    }
    if (spec.kind === 'string') {
      if (!spec.options?.length) return null
      return (
        <SegmentedControl
          key={spec.id}
          onChange={(next) => rebuild(spec.id, next)}
          options={spec.options.map((option) => ({ label: option, value: option }))}
          value={String(value)}
        />
      )
    }
    const current = drafts[spec.id] ?? Number(value)
    const span = Math.max(Math.abs(Number(spec.default)), 1)
    return (
      <SliderControl
        key={spec.id}
        label={label}
        max={spec.max ?? Number(spec.default) + span}
        min={spec.min ?? Number(spec.default) - span}
        onChange={(next) => setDrafts((d) => ({ ...d, [spec.id]: next }))}
        onCommit={(next) => rebuild(spec.id, next)}
        precision={spec.step !== undefined && spec.step < 1 ? 2 : 0}
        restoreOnCommit={false}
        step={spec.step ?? 0.01}
        unit={spec.unit}
        value={current}
      />
    )
  }

  return (
    <PanelSection title="Parameters">
      {source.manifest.params.map(control)}
      {busy ? <div className="px-2 py-1 text-muted-foreground text-xs">Rebuilding…</div> : null}
      {error ? <div className="px-2 py-1 text-red-400 text-xs">{error}</div> : null}
    </PanelSection>
  )
}
