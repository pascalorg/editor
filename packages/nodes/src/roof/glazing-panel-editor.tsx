'use client'

import {
  getGlazedRoofLayout,
  getGlazedRoofPanelType,
  getRoofGlazing,
  type MessageDescriptor,
  type PascalI18n,
  type RoofGlazing,
  type RoofSegmentNode,
  usePascalI18n,
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

const FACE_LABELS: Record<string, MessageDescriptor> = {
  front: /* i18n */ { id: 'node.roof.glazing.face.front', message: 'Front slope' },
  back: /* i18n */ { id: 'node.roof.glazing.face.back', message: 'Back slope' },
  slope: /* i18n */ { id: 'node.roof.glazing.face.slope', message: 'Shed slope' },
  'end-left': /* i18n */ { id: 'node.roof.glazing.face.endLeft', message: 'Left end' },
  'end-right': /* i18n */ { id: 'node.roof.glazing.face.endRight', message: 'Right end' },
}

function faceLabel(id: string, i18n: PascalI18n): string {
  if (id.startsWith('barrel-'))
    return i18n._({
      id: 'node.roof.glazing.face.archBay',
      message: 'Arch bay {number}',
      values: { number: Number(id.slice(7)) + 1 },
    })
  const label = FACE_LABELS[id]
  return label ? i18n._(label) : id
}

export function GlazingPanelEditor({
  node,
  onUpdate,
}: {
  node: RoofSegmentNode
  onUpdate: (patch: Partial<RoofGlazing>) => void
}) {
  const i18n = usePascalI18n()
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
    <PanelSection
      title={i18n._({
        id: 'node.roof.glazingPanelEditor.individualPanels',
        message: 'Individual panels',
      })}
      defaultExpanded={false}
    >
      <p className="pb-1 text-[11px] leading-relaxed text-muted-foreground">
        {i18n._({
          id: 'node.roof.glazingPanelEditor.chooseAPanelToOverrideIts',
          message: 'Choose a panel to override its default infill.',
        })}
      </p>
      <SelectControl
        label={i18n._({ id: 'node.roof.glazingPanelEditor.roofFace', message: 'Roof face' })}
        value={layout.face.id}
        options={layouts.map(({ face }) => ({ value: face.id, label: faceLabel(face.id, i18n) }))}
        onChange={(value) => {
          setFaceId(value)
          setColumn(0)
          setRow(0)
        }}
      />
      <p className="py-1 text-[11px] text-muted-foreground">
        {i18n._({
          id: 'node.roof.glazingPanelEditor.grid',
          message:
            '{columns, plural, one {{columnCount} column} other {{columnCount} columns}} · {rows, plural, one {{rowCount} row} other {{rowCount} rows}}',
          values: { columns, rows, columnCount: String(columns), rowCount: String(rows) },
        })}
      </p>
      {columns > 1 && (
        <SliderControl
          label={i18n._({ id: 'node.roof.glazingPanelEditor.column2', message: 'Column' })}
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
          label={i18n._({ id: 'node.roof.glazingPanelEditor.row2', message: 'Row' })}
          value={activeRow + 1}
          min={1}
          max={rows}
          step={1}
          precision={0}
          onChange={(value) => setRow(Math.round(value) - 1)}
        />
      )}
      <div
        className="flex flex-col gap-2 pt-1"
        role="group"
        aria-label={i18n._({
          id: 'node.roof.glazingPanelEditor.selectedPanelInfill',
          message: 'Selected panel infill',
        })}
      >
        <span className="flex items-center justify-between text-xs text-muted-foreground">
          {i18n._({ id: 'node.roof.glazingPanelEditor.panelInfill', message: 'Panel infill' })}{' '}
          <span className="text-[11px]">
            {overridden
              ? i18n._({ id: 'node.roof.glazingPanelEditor.custom', message: 'Custom' })
              : i18n._({ id: 'node.roof.glazingPanelEditor.default', message: 'Default' })}
          </span>
        </span>
        <SegmentedControl
          value={getGlazedRoofPanelType(node, layout.face.id, activeColumn, activeRow)}
          options={GLAZING_INFILL_OPTIONS.map((option) => ({
            ...option,
            label: i18n._(option.label),
          }))}
          onChange={(type) => update(type)}
        />
      </div>
      <ActionButton
        label={i18n._({
          id: 'node.roof.glazingPanelEditor.resetToDefault',
          message: 'Reset to default',
        })}
        icon={<RotateCcw className="size-3.5" />}
        disabled={!overridden}
        className="mt-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#2C2C2E]"
        onClick={() => update()}
      />
    </PanelSection>
  )
}
