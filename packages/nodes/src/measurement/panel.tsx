'use client'

import {
  type AnyNode,
  type MeasurementNode,
  measurementArea,
  measurementDistance,
  measurementPrismVolume,
  useScene,
} from '@pascal-app/core'
import {
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

function getMeasurementLabel(node: MeasurementNode): string {
  switch (node.measurement.kind) {
    case 'distance':
      return 'Distance'
    case 'area':
      return 'Area'
    case 'volume':
      return 'Volume'
  }
}

function getMeasurementValue(node: MeasurementNode, unit: 'metric' | 'imperial'): string {
  switch (node.measurement.kind) {
    case 'distance':
      return formatLinearMeasurement(measurementDistance(...node.measurement.points), unit)
    case 'area':
      return formatAreaLabel(measurementArea(node.measurement.base), unit)
    case 'volume':
      return formatVolumeLabel(
        measurementPrismVolume(node.measurement.base, node.measurement.extrusion),
        unit,
      )
  }
}

function getGeometrySummary(node: MeasurementNode, unit: 'metric' | 'imperial'): string {
  switch (node.measurement.kind) {
    case 'distance':
      return '2 endpoints'
    case 'area':
      return `${node.measurement.base.length} vertices`
    case 'volume': {
      const [x, y, z] = node.measurement.extrusion
      const extrusion = formatLinearMeasurement(Math.hypot(x, y, z), unit)
      return `${node.measurement.base.length} base vertices, ${extrusion} extrusion`
    }
  }
}

export default function MeasurementPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const unit = useViewer((state) => state.unit)
  const updateNode = useScene((state) => state.updateNode)
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
  const value = getMeasurementValue(node, unit)
  const geometry = getGeometrySummary(node, unit)

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
      </PanelSection>
    </PanelWrapper>
  )
}
