'use client'

import { useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo, useState } from 'react'
import { metresToFeet, totalsBySystem } from './geometry/totals'
import { asNodeId, isServicePoint, isUtilityLine, isUtilityPole } from './kind-guards'
import {
  DEFAULT_BURIAL_DEPTH,
  SERVICE_POINT_ABBR,
  SERVICE_POINT_KINDS,
  SERVICE_POINT_LABEL,
  type ServicePointKind,
  SYSTEM_COLOR,
  SYSTEM_LABEL,
  SYSTEM_MATERIALS,
  type UtilitySystem,
  UTILITY_SYSTEMS,
} from './schema'
import { burialDepth, calloutText } from './utility-line/floorplan'
import { lineLength } from './geometry/totals'

const ROUTINGS = ['underground', 'overhead'] as const

/**
 * The Utilities panel.
 *
 * Placement buttons seed `toolDefaults` before activating the tool — that is
 * the only way a plugin can pass a starting parameter into a registered
 * floor-plan tool (`FloorplanRegisteredToolLayer` reads
 * `useEditor.toolDefaults[tool]`), so the system / routing / service-kind
 * choosers live here rather than in the host tool bar, which has no plugin
 * seam.
 *
 * `setMode('build')` is deliberate and not redundant: the registered tool
 * layer returns null unless `mode === 'build'`, and `setTool` alone does not
 * change the mode.
 */
export default function UtilitiesPanel() {
  const nodes = useScene((state) => state.nodes)
  const setTool = useEditor((state) => state.setTool)
  const setMode = useEditor((state) => state.setMode)
  const setToolDefaults = useEditor((state) => state.setToolDefaults)
  const [system, setSystem] = useState<UtilitySystem>('power')
  const [routing, setRouting] = useState<(typeof ROUTINGS)[number]>('underground')
  const [serviceKind, setServiceKind] = useState<ServicePointKind>('electric-meter')

  const lines = useMemo(() => (Object.values(nodes) as unknown[]).filter(isUtilityLine), [nodes])
  const poles = useMemo(() => (Object.values(nodes) as unknown[]).filter(isUtilityPole), [nodes])
  const points = useMemo(() => (Object.values(nodes) as unknown[]).filter(isServicePoint), [nodes])
  const totals = useMemo(() => totalsBySystem(lines), [lines])

  const select = (id: string) => useViewer.getState().setSelection({ selectedIds: [asNodeId(id)] })

  const startTool = (tool: string, defaults?: Record<string, unknown>) => {
    if (defaults) setToolDefaults(tool, defaults)
    setMode('build')
    setTool(tool)
  }

  const toggleRouting = (id: string, current: (typeof ROUTINGS)[number]) => {
    const next = current === 'overhead' ? 'underground' : 'overhead'
    const line = lines.find((candidate) => candidate.id === id)
    if (!line) return
    // Burying a run has to move it underground and lifting it has to raise
    // it — flipping only the flag would leave an "underground" line drawn in
    // the air. Vertices that already carry a sensible elevation keep it.
    const path = line.path.map((point) => {
      const y =
        next === 'underground'
          ? point[1] < 0
            ? point[1]
            : DEFAULT_BURIAL_DEPTH
          : point[1] > 0
            ? point[1]
            : 5.5
      return [point[0], y, point[2]] as [number, number, number]
    })
    // Plugin kinds are outside core's `AnyNode` union, so the patch is
    // structurally correct but not nameable in the host's types (the same
    // cast plugin-bones uses for its own fields).
    useScene.getState().updateNode(asNodeId(id), { routing: next, path } as never)
  }

  const chip = (color: string) => (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )

  const rowClass =
    'flex w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:text-foreground'

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-foreground">
      {/* ── Placement ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">New run</div>
        <div className="flex flex-wrap gap-1">
          {UTILITY_SYSTEMS.map((option) => (
            <button
              aria-pressed={system === option}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition ${
                system === option
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              key={option}
              onClick={() => setSystem(option)}
              type="button"
            >
              {chip(SYSTEM_COLOR[option])}
              {SYSTEM_LABEL[option]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {ROUTINGS.map((option) => (
            <button
              aria-pressed={routing === option}
              className={`flex-1 rounded-md border px-2 py-1 text-[11px] capitalize transition ${
                routing === option
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              key={option}
              onClick={() => setRouting(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
        <button
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs hover:bg-accent"
          onClick={() => startTool('utility-line', { system, routing })}
          type="button"
        >
          Draw utility line
        </button>
        <div className="text-[10px] text-muted-foreground leading-snug">
          Click each vertex, double-click or Enter to finish. Endpoints snap to poles and service
          points; hold Alt to ignore both snap and grid.
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs hover:bg-accent"
          onClick={() => startTool('utility-pole')}
          type="button"
        >
          Place pole
        </button>
        <button
          className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs hover:bg-accent"
          onClick={() => startTool('service-point', { serviceKind })}
          type="button"
        >
          Place service point
        </button>
      </div>
      <select
        className="rounded-md border border-border bg-card px-2 py-1 text-xs"
        onChange={(event) => setServiceKind(event.target.value as ServicePointKind)}
        value={serviceKind}
      >
        {SERVICE_POINT_KINDS.map((option) => (
          <option key={option} value={option}>
            {SERVICE_POINT_LABEL[option]}
          </option>
        ))}
      </select>

      {/* ── Totals ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Linear feet by system
        </div>
        {totals.length === 0 ? (
          <div className="rounded-md border border-border border-dashed px-2 py-3 text-center text-muted-foreground text-xs">
            No runs yet.
          </div>
        ) : (
          totals.map((total) => (
            <div
              className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              key={total.system}
            >
              {chip(SYSTEM_COLOR[total.system])}
              <span className="font-medium">{SYSTEM_LABEL[total.system]}</span>
              <span className="ml-auto tabular-nums">{Math.round(total.feet)} LF</span>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(metresToFeet(total.overheadMetres))} OH /{' '}
                {Math.round(metresToFeet(total.undergroundMetres))} UG
              </span>
            </div>
          ))
        )}
      </div>

      {/* ── Runs ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Runs</div>
        {lines.map((line) => (
          <div className="flex flex-col gap-1" key={line.id}>
            <button className={rowClass} onClick={() => select(line.id)} type="button">
              {chip(SYSTEM_COLOR[line.system])}
              <span className="font-medium text-foreground">{SYSTEM_LABEL[line.system]}</span>
              <span className="truncate">{calloutText(line) || '—'}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {Math.round(metresToFeet(lineLength(line)))} LF
              </span>
            </button>
            <div className="flex items-center gap-2 pl-2 text-[10px] text-muted-foreground">
              <button
                className="rounded border border-border px-1.5 py-0.5 capitalize hover:text-foreground"
                onClick={() => toggleRouting(line.id, line.routing)}
                type="button"
              >
                {line.routing} ⇄
              </button>
              {line.routing === 'underground' ? (
                <span>{(burialDepth(line) * 39.3701).toFixed(0)}″ cover</span>
              ) : (
                <span>{(line.sagRatio * 100).toFixed(1)}% sag</span>
              )}
              {line.material ? <span className="uppercase">{line.material}</span> : null}
              {SYSTEM_MATERIALS[line.system].length > 0 ? (
                <select
                  className="ml-auto rounded border border-border bg-card px-1 py-0.5"
                  onChange={(event) =>
                    useScene
                      .getState()
                      .updateNode(asNodeId(line.id), {
                        material: event.target.value || null,
                      } as never)
                  }
                  value={line.material ?? ''}
                >
                  <option value="">material…</option>
                  {SYSTEM_MATERIALS[line.system].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>
        ))}
        {lines.length === 0 ? (
          <div className="rounded-md border border-border border-dashed px-2 py-3 text-center text-muted-foreground text-xs">
            No utility lines yet.
          </div>
        ) : null}
      </div>

      {/* ── Poles and points ──────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Poles and service points
        </div>
        {poles.map((pole) => (
          <button className={rowClass} key={pole.id} onClick={() => select(pole.id)} type="button">
            {chip(SYSTEM_COLOR.power)}
            <span className="font-medium text-foreground">
              {pole.label || 'Pole'}
              {pole.classLabel ? ` · ${pole.classLabel}` : ''}
            </span>
            <span className="ml-auto tabular-nums">
              {Math.round(metresToFeet(pole.height))}′{pole.hasTransformer ? ' · XFMR' : ''}
            </span>
          </button>
        ))}
        {points.map((point) => (
          <button
            className={rowClass}
            key={point.id}
            onClick={() => select(point.id)}
            type="button"
          >
            {chip(SYSTEM_COLOR.power)}
            <span className="font-medium text-foreground">
              {SERVICE_POINT_LABEL[point.serviceKind]}
            </span>
            <span className="ml-auto">{SERVICE_POINT_ABBR[point.serviceKind]}</span>
            <span className="text-[10px]">{point.wallId ? 'on wall' : 'free'}</span>
          </button>
        ))}
        {poles.length === 0 && points.length === 0 ? (
          <div className="rounded-md border border-border border-dashed px-2 py-3 text-center text-muted-foreground text-xs">
            Nothing placed yet.
          </div>
        ) : null}
      </div>
    </div>
  )
}
