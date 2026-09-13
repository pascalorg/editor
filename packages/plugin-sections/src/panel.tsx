'use client'

import { useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { AlertTriangle, Compass, Scissors } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildElevationDrawing } from './geometry/elevation'
import { buildBuildingModel } from './geometry/scene-model'
import { buildSectionDrawing } from './geometry/section'
import type { DrawingResult } from './geometry/types'
import { isElevationMarker, isSectionMarker } from './kind-guards'
import { SectionPreview } from './preview'

type Selection =
  | { kind: 'section'; id: string }
  | { kind: 'elevation'; direction: 'north' | 'east' | 'south' | 'west' }

const DIRECTIONS = ['north', 'east', 'south', 'west'] as const

export default function SectionsPanel() {
  const nodes = useScene((state) => state.nodes)
  const setTool = useEditor((state) => state.setTool)
  const [selection, setSelection] = useState<Selection | null>(null)

  const markers = useMemo(
    () => (Object.values(nodes) as unknown[]).filter(isSectionMarker),
    [nodes],
  )
  const elevationMarkers = useMemo(
    () => (Object.values(nodes) as unknown[]).filter(isElevationMarker),
    [nodes],
  )

  const active: Selection | null =
    selection ??
    (markers[0]
      ? { kind: 'section', id: markers[0].id }
      : { kind: 'elevation', direction: 'south' })

  const drawing: DrawingResult | null = useMemo(() => {
    if (!active) return null
    // One model walk feeds whichever drawing is showing.
    const model = buildBuildingModel(nodes)
    return active.kind === 'section'
      ? buildSectionDrawing({ nodes }, { markerId: active.id }, model)
      : buildElevationDrawing({ nodes }, active.direction, model)
  }, [nodes, active])

  const rowClass = (isActive: boolean) =>
    `flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
      isActive
        ? 'border-primary bg-primary/10 text-foreground'
        : 'border-border bg-card text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-foreground">
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs hover:bg-accent"
          onClick={() => setTool('section-marker')}
        >
          Place section
        </button>
        <button
          type="button"
          className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs hover:bg-accent"
          onClick={() => setTool('elevation-marker')}
        >
          Place elevation
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Sections</div>
        {markers.length === 0 ? (
          <div className="rounded-md border border-border border-dashed px-2 py-3 text-center text-muted-foreground text-xs">
            No section markers yet.
          </div>
        ) : (
          markers.map((marker) => (
            <button
              type="button"
              key={marker.id}
              className={rowClass(active?.kind === 'section' && active.id === marker.id)}
              onClick={() => setSelection({ kind: 'section', id: marker.id })}
            >
              <Scissors className="size-3.5 shrink-0" />
              <span className="font-medium">Section {marker.label}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {Math.hypot(
                  marker.end[0] - marker.start[0],
                  marker.end[1] - marker.start[1],
                ).toFixed(2)}{' '}
                m
              </span>
            </button>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Elevations</div>
        {DIRECTIONS.map((direction) => {
          const marker = elevationMarkers.find((m) => m.direction === direction)
          return (
            <button
              type="button"
              key={direction}
              className={rowClass(active?.kind === 'elevation' && active.direction === direction)}
              onClick={() => setSelection({ kind: 'elevation', direction })}
            >
              <Compass className="size-3.5 shrink-0" />
              <span className="font-medium capitalize">{direction}</span>
              {marker ? (
                <span className="ml-auto text-[11px] text-muted-foreground">{marker.label}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="min-h-64 flex-1 rounded-md border border-border bg-card p-2">
        {drawing ? <SectionPreview drawing={drawing} background="#ffffff" /> : null}
      </div>

      {drawing && drawing.warnings.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
            <AlertTriangle className="size-3.5" />
            What this drawing could not compute
          </div>
          {drawing.warnings.map((warning) => (
            <div key={warning} className="text-[11px] text-muted-foreground leading-snug">
              {warning}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
