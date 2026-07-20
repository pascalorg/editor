'use client'

import type { AnyNodeId, ConstructionDimensionNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'

const MODE_LABELS: Record<ConstructionDimensionNode['mode'], string> = {
  linear: 'Linear',
  radius: 'Radius',
  diameter: 'Diameter',
  'center-mark': 'Center mark',
  chord: 'Chord',
  'arc-length': 'Arc length',
  angular: 'Angular',
  coordinate: 'Coordinate',
}

export default function ConstructionDimensionPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const node = useScene((state) => (selectedId ? state.nodes[selectedId as AnyNodeId] : undefined))
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)
  const dimension = node?.type === 'construction-dimension' ? node : null

  if (!(dimension && selectedId)) return null
  const update = (patch: Partial<ConstructionDimensionNode>) => updateNode(dimension.id, patch)
  const supportsCenterMark = ['radius', 'diameter', 'arc-length', 'angular'].includes(
    dimension.mode,
  )

  return (
    <PanelWrapper
      icon="/icons/blueprint.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title="Construction Dimension"
      width={320}
    >
      <PanelSection title="Dimension">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Mode</span>
          <span className="font-medium text-foreground">{MODE_LABELS[dimension.mode]}</span>
        </div>
        <SliderControl
          label="Feature count"
          max={999}
          min={1}
          onChange={(featureCount) => update({ featureCount })}
          precision={0}
          step={1}
          value={dimension.featureCount}
        />
        {supportsCenterMark ? (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Center mark</span>
            <input
              checked={dimension.showCenterMark}
              onChange={(event) => update({ showCenterMark: event.target.checked })}
              type="checkbox"
            />
          </label>
        ) : null}
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Reference</span>
          <input
            checked={dimension.reference}
            onChange={(event) => update({ reference: event.target.checked })}
            type="checkbox"
          />
        </label>
      </PanelSection>

      <PanelSection title="Notation">
        <TextField
          label="Prefix"
          onCommit={(prefix) => update({ prefix })}
          value={dimension.prefix}
        />
        <TextField
          label="Suffix"
          onCommit={(suffix) => update({ suffix })}
          value={dimension.suffix}
        />
        <TextField
          label="Text override"
          onCommit={(textOverride) => update({ textOverride: textOverride || null })}
          placeholder="Use measured value"
          value={dimension.textOverride ?? ''}
        />
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={() => {
              triggerSFX('sfx:structure-delete')
              deleteNode(dimension.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

function TextField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
        defaultValue={value}
        key={value}
        onBlur={(event) => onCommit(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}
