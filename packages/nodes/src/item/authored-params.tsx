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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@pascal-app/editor'
import { RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { isScriptDefault, scriptDefault, scriptDefaultsPatch } from './script-param-defaults'

/**
 * The params an authored object's script declares, as controls. Sliders
 * preview their value while dragging and rebuild on release (a rebuild runs
 * the script again: tens to hundreds of milliseconds). A param changed from
 * the script's default can be put back, alone or with all the others.
 */
export function AuthoredParams({
  node,
}: {
  node: { id: string; source?: ScriptedNode['source'] }
}) {
  const source = node.source
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const rebuilding = useRef(false)
  const [error, setError] = useState<string | null>(null)
  if (!source || source.manifest.params.length === 0) return null

  const rebuild = (patch: Record<string, GeometryScriptParamValue>) => {
    if (rebuilding.current) return
    rebuilding.current = true
    setBusy(true)
    setError(null)
    rebuildAuthoredObject(node.id, patch)
      .catch((reason: unknown) => {
        console.error('[authored object] rebuild failed', reason)
        setError("Couldn't rebuild with these values.")
      })
      .finally(() => {
        rebuilding.current = false
        setBusy(false)
        setDrafts((current) => {
          const rest = { ...current }
          for (const id of Object.keys(patch)) delete rest[id]
          return rest
        })
      })
  }

  const control = (spec: GeometryScriptParamSpec) => {
    const value = source.params[spec.id] ?? scriptDefault(spec)
    const label = spec.label ?? spec.id
    if (spec.kind === 'boolean') {
      return (
        <ToggleControl
          checked={Boolean(value)}
          label={label}
          onChange={(checked) => rebuild({ [spec.id]: checked })}
        />
      )
    }
    if (spec.kind === 'string') {
      if (!spec.options?.length) {
        return (
          <div className="flex h-7 items-center justify-between gap-2 px-2 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="truncate">{String(value)}</span>
          </div>
        )
      }
      return (
        <SegmentedControl
          onChange={(next) => rebuild({ [spec.id]: next })}
          options={spec.options.map((option) => ({ label: option, value: option }))}
          value={String(value)}
        />
      )
    }
    const current = drafts[spec.id] ?? Number(value)
    const span = Math.max(Math.abs(Number(spec.default)), 1)
    return (
      <SliderControl
        label={label}
        max={spec.max ?? Number(spec.default) + span}
        min={spec.min ?? Number(spec.default) - span}
        onChange={(next) => {
          if (!rebuilding.current) setDrafts((d) => ({ ...d, [spec.id]: next }))
        }}
        onCommit={(next) => rebuild({ [spec.id]: next })}
        precision={spec.step !== undefined && spec.step < 1 ? 2 : 0}
        restoreOnCommit={false}
        step={spec.step ?? 0.01}
        unit={spec.unit}
        value={current}
      />
    )
  }

  const row = (spec: GeometryScriptParamSpec) => {
    const input = control(spec)
    return (
      <div className="flex items-center gap-1" inert={busy} key={spec.id}>
        <div className="min-w-0 flex-1">{input}</div>
        {isScriptDefault(spec, source.params[spec.id]) ? null : (
          <ResetButton
            label={`Reset ${spec.label ?? spec.id}`}
            onClick={() => rebuild({ [spec.id]: scriptDefault(spec) })}
          />
        )}
      </div>
    )
  }

  const resetAll = scriptDefaultsPatch(source.manifest.params, source.params)

  return (
    <PanelSection title="Parameters">
      {source.manifest.params.map(row)}
      {Object.keys(resetAll).length > 0 ? (
        <button
          className="mt-1 flex h-8 items-center justify-center gap-1.5 rounded-full border border-border/50 px-3 font-medium text-foreground text-xs transition-colors hover:bg-accent/50"
          data-authored-params-reset
          disabled={busy}
          onClick={() => rebuild(resetAll)}
          type="button"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset parameters
        </button>
      ) : null}
      {busy ? <div className="px-2 py-1 text-muted-foreground text-xs">Rebuilding…</div> : null}
      {error ? <div className="px-2 py-1 text-red-400 text-xs">{error}</div> : null}
    </PanelSection>
  )
}

function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          data-authored-param-reset
          onClick={onClick}
          type="button"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Reset to default</TooltipContent>
    </Tooltip>
  )
}
