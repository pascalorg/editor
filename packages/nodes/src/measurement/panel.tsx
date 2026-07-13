'use client'

import {
  type AnyNode,
  type MeasurementNode,
  measurementAngle,
  measurementArea,
  measurementDistance,
  measurementPerimeter,
  measurementPrismVolume,
  useScene,
} from '@pascal-app/core'
import {
  formatAngleRadians,
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  PanelSection,
  PanelWrapper,
  ToggleControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Ruler } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  detachMeasurementPayload,
  type ResolvedMeasurementPayload,
  resolveMeasurementNode,
} from './resolve'

function getMeasurementLabel(node: MeasurementNode): string {
  switch (node.measurement.kind) {
    case 'distance':
      return 'Distance'
    case 'angle':
      return 'Angle'
    case 'area':
      return 'Area'
    case 'perimeter':
      return 'Perimeter'
    case 'volume':
      return 'Volume'
  }
}

function getMeasurementValue(
  measurement: ResolvedMeasurementPayload,
  unit: 'metric' | 'imperial',
): string {
  switch (measurement.kind) {
    case 'distance':
      return formatLinearMeasurement(measurementDistance(...measurement.points), unit)
    case 'angle':
      return formatAngleRadians(measurementAngle(...measurement.points))
    case 'area':
      return formatAreaLabel(measurementArea(measurement.base), unit)
    case 'perimeter':
      return formatLinearMeasurement(measurementPerimeter(measurement.base), unit)
    case 'volume':
      return formatVolumeLabel(
        measurementPrismVolume(measurement.base, measurement.extrusion),
        unit,
      )
  }
}

function getGeometrySummary(
  measurement: ResolvedMeasurementPayload,
  unit: 'metric' | 'imperial',
): string {
  switch (measurement.kind) {
    case 'distance':
      return '2 endpoints'
    case 'angle':
      return '3 points'
    case 'area':
    case 'perimeter':
      return `${measurement.base.length} vertices`
    case 'volume': {
      const [x, y, z] = measurement.extrusion
      const extrusion = formatLinearMeasurement(Math.hypot(x, y, z), unit)
      return `${measurement.base.length} base vertices, ${extrusion} extrusion`
    }
  }
}

export default function MeasurementPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const unit = useViewer((state) => state.unit)
  const updateNode = useScene((state) => state.updateNode)
  const nodes = useScene((state) => state.nodes)
  const node = useScene((state) =>
    selectedId
      ? (state.nodes[selectedId as AnyNode['id']] as MeasurementNode | undefined)
      : undefined,
  )
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    setDraftName(node?.name ?? '')
  }, [node?.name])

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const commitName = useCallback(
    (value: string) => {
      if (!(node && selectedId)) return
      const name = value.trim()
      if (name === (node.name ?? '')) return
      updateNode(selectedId as AnyNode['id'], { name: name || undefined })
    },
    [node, selectedId, updateNode],
  )

  if (!(node && node.type === 'measurement' && selectedId)) return null

  const label = getMeasurementLabel(node)
  const resolved = resolveMeasurementNode(node, (id) => nodes[id])
  const value = getMeasurementValue(resolved.payload, unit)
  const geometry = getGeometrySummary(resolved.payload, unit)
  const associated = resolved.dependencies.length > 0

  return (
    <PanelWrapper
      icon={<Ruler aria-hidden="true" className="h-4 w-4" />}
      onClose={handleClose}
      title={node.name || label}
      width={300}
    >
      <PanelSection title="Identity">
        <label className="flex flex-col gap-1.5">
          <span className="px-1 text-muted-foreground text-xs">Name</span>
          <input
            aria-label="Measurement name"
            className="h-10 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-foreground text-sm outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-[#3e3e3e] focus:border-foreground/40"
            onBlur={(event) => commitName(event.currentTarget.value)}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                const storedName = node.name ?? ''
                setDraftName(storedName)
                event.currentTarget.value = storedName
                event.currentTarget.blur()
              }
            }}
            placeholder={label}
            type="text"
            value={draftName}
          />
        </label>
        <ToggleControl
          checked={node.visible !== false}
          label="Visible"
          onChange={(visible) => updateNode(selectedId as AnyNode['id'], { visible })}
        />
      </PanelSection>

      <PanelSection title="Measurement">
        <div className="flex items-baseline justify-between gap-3 px-2 py-1.5">
          <span className="text-muted-foreground text-sm">{label}</span>
          <output
            aria-label={`${label} value`}
            className="font-medium font-mono text-foreground text-lg"
          >
            {value}
          </output>
        </div>
        <div className="flex items-start justify-between gap-3 px-2 py-1.5 text-sm">
          <span className="shrink-0 text-muted-foreground">Geometry</span>
          <span className="text-right text-foreground/90">{geometry}</span>
        </div>
        <div className="flex items-start justify-between gap-3 px-2 py-1.5 text-sm">
          <span className="shrink-0 text-muted-foreground">Association</span>
          <span className={resolved.dangling.length > 0 ? 'text-red-400' : 'text-foreground/90'}>
            {resolved.dangling.length > 0
              ? `${resolved.dangling.length} unlinked`
              : associated
                ? 'Linked'
                : 'Free'}
          </span>
        </div>
        {associated && (
          <button
            className="mt-2 h-9 w-full rounded-full border border-border/60 px-3 text-sm transition-colors hover:bg-muted"
            onClick={() =>
              updateNode(selectedId as AnyNode['id'], {
                measurement: detachMeasurementPayload(node, (id) => nodes[id]),
              })
            }
            type="button"
          >
            Detach measurement
          </button>
        )}
      </PanelSection>
    </PanelWrapper>
  )
}
