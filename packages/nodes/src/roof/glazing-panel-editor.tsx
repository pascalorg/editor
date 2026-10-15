'use client'

import {
  getGlazedRoofLayout,
  getGlazedRoofPanelType,
  getRoofGlazing,
  type RoofGlazing,
  type RoofSegmentNode,
} from '@pascal-app/core'
import {
  ActionButton,
  PanelSection,
  SegmentedControl,
  SelectControl,
  SliderControl,
} from '@pascal-app/editor'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { GLAZING_INFILL_OPTIONS } from './glazing-controls'

function faceLabel(id: string): string {
  if (id.startsWith('barrel-')) return `Arch bay ${Number(id.slice(7)) + 1}`
  const labels: Record<string, string> = {
    front: 'Front slope',
    back: 'Back slope',
    slope: 'Shed slope',
    'end-left': 'Left end',
    'end-right': 'Right end',
  }
  return labels[id] ?? id
}

export function GlazingPanelEditor({
  node,
  onUpdate,
}: {
  node: RoofSegmentNode
  onUpdate: (patch: Partial<RoofGlazing>) => void
}) {
  const [faceId, setFaceId] = useState('front')
  const [column, setColumn] = useState(0)
  const [row, setRow] = useState(0)
  const config = getRoofGlazing(node)
  const layouts = getGlazedRoofLayout(node).filter(
    ({ face, across, along }) => face.polygon.length >= 3 && across.length > 1 && along.length > 1,
  )
  const layout = layouts.find((entry) => entry.face.id === faceId) ?? layouts[0]
  if (!layout) return null
  const columns = layout.across.length - 1,
    rows = layout.along.length - 1
  const activeColumn = Math.max(0, Math.min(column, columns - 1)),
    activeRow = Math.max(0, Math.min(row, rows - 1))
  const matches = (panel: RoofGlazing['panels'][number]) =>
    panel.face === layout.face.id && panel.column === activeColumn && panel.row === activeRow
  const overridden = config.panels.some(matches)
  const update = (type?: RoofGlazing['panelType']) =>
    onUpdate({
      panels: [
        ...config.panels.filter((panel) => !matches(panel)),
        ...(type ? [{ face: layout.face.id, column: activeColumn, row: activeRow, type }] : []),
      ],
    })
  return (
    <PanelSection title="Individual panels" defaultExpanded={false}>
      <p className="pb-1 text-[11px] leading-relaxed text-muted-foreground">
        Choose a panel to override its default infill.
      </p>
      <SelectControl
        label="Roof face"
        value={layout.face.id}
        options={layouts.map(({ face }) => ({ value: face.id, label: faceLabel(face.id) }))}
        onChange={(value) => {
          setFaceId(value)
          setColumn(0)
          setRow(0)
        }}
      />
      <p className="py-1 text-[11px] text-muted-foreground">
        {columns} {columns === 1 ? 'column' : 'columns'} · {rows} {rows === 1 ? 'row' : 'rows'}
      </p>
      {columns > 1 && (
        <SliderControl
          label="Column"
          value={activeColumn + 1}
          min={1}
          max={columns}
          step={1}
          precision={0}
          onChange={(value) => setColumn(Math.round(value) - 1)}
        />
      )}
      {rows > 1 && (
        <SliderControl
          label="Row"
          value={activeRow + 1}
          min={1}
          max={rows}
          step={1}
          precision={0}
          onChange={(value) => setRow(Math.round(value) - 1)}
        />
      )}
      <div className="flex flex-col gap-2 pt-1" role="group" aria-label="Selected panel infill">
        <span className="flex items-center justify-between text-xs text-muted-foreground">
          Panel infill <span className="text-[11px]">{overridden ? 'Custom' : 'Default'}</span>
        </span>
        <SegmentedControl
          value={getGlazedRoofPanelType(node, layout.face.id, activeColumn, activeRow)}
          options={GLAZING_INFILL_OPTIONS}
          onChange={(type) => update(type)}
        />
      </div>
      <ActionButton
        label="Reset to default"
        icon={<RotateCcw className="size-3.5" />}
        disabled={!overridden}
        className="mt-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#2C2C2E]"
        onClick={() => update()}
      />
    </PanelSection>
  )
}
