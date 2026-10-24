'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofSegmentNode,
  SOLAR_PANEL_PRESET_LABELS,
  SOLAR_PANEL_PRESETS,
  type SolarPanelNode,
  type SolarPanelPresetKey,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { computeAutoFit, solarPanelObstacles } from './auto-fit'
import { flippedPanelDims } from './geometry'

const cn = (...classes: Array<string | false | undefined | null>): string =>
  classes.filter(Boolean).join(' ')

// Editing any of these clears panelTypePreset back to undefined ("Custom"),
// keeping the schema invariant: a present preset always matches the table.
const PRESET_OWNED_FIELDS: ReadonlyArray<keyof SolarPanelNode> = [
  'panelWidth',
  'panelHeight',
  'frameThickness',
  'frameDepth',
]

const PRESET_CARDS: { key: SolarPanelPresetKey; label: string }[] = [
  { key: 'residential', label: SOLAR_PANEL_PRESET_LABELS.residential },
  { key: 'residential-large', label: SOLAR_PANEL_PRESET_LABELS['residential-large'] },
  { key: 'compact', label: SOLAR_PANEL_PRESET_LABELS.compact },
  { key: 'frameless', label: SOLAR_PANEL_PRESET_LABELS.frameless },
]

function dimsTouchedByUpdate(updates: Partial<SolarPanelNode>): boolean {
  for (const field of PRESET_OWNED_FIELDS) {
    if (field in updates) return true
  }
  return false
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export default function SolarPanelPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as SolarPanelNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId
      ? (s.get(selectedId as AnyNodeId) as Partial<SolarPanelNode> | undefined)
      : undefined,
  )
  const node =
    storeNode && overrides ? ({ ...storeNode, ...overrides } as SolarPanelNode) : storeNode
  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const [autoFitMessage, setAutoFitMessage] = useState<string | null>(null)
  useEffect(() => {
    if (!autoFitMessage) return
    const t = window.setTimeout(() => setAutoFitMessage(null), 3500)
    return () => window.clearTimeout(t)
  }, [autoFitMessage])

  const handleUpdate = useCallback(
    (updates: Partial<SolarPanelNode>) => {
      if (!selectedId) return
      const next: Partial<SolarPanelNode> = dimsTouchedByUpdate(updates)
        ? { ...updates, panelTypePreset: undefined }
        : updates
      updateNode(selectedId as AnyNode['id'], next)
    },
    [selectedId, updateNode],
  )

  const previewProp = useCallback(
    (updates: Partial<SolarPanelNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )
  const commitProp = useCallback(
    (updates: Partial<SolarPanelNode>) => {
      if (!selectedId) return
      const next: Partial<SolarPanelNode> = dimsTouchedByUpdate(updates)
        ? { ...updates, panelTypePreset: undefined }
        : updates
      updateNode(selectedId as AnyNode['id'], next)
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleBack = useCallback(() => {
    if (node?.roofSegmentId) {
      setSelection({ selectedIds: [node.roofSegmentId as AnyNode['id']] })
    }
  }, [node?.roofSegmentId, setSelection])

  const handlePresetChange = useCallback(
    (key: SolarPanelPresetKey) => {
      if (!selectedId) return
      const dims = SOLAR_PANEL_PRESETS[key]
      updateNode(selectedId as AnyNode['id'], { panelTypePreset: key, ...dims })
    },
    [selectedId, updateNode],
  )

  const handleFlip = useCallback(() => {
    if (!(selectedId && node)) return
    updateNode(selectedId as AnyNode['id'], {
      ...flippedPanelDims(node),
      panelTypePreset: undefined,
    })
  }, [selectedId, node, updateNode])

  const handleAutoFit = useCallback(() => {
    if (!(selectedId && node && segment)) return
    const obstacles = solarPanelObstacles(segment, node, Object.values(useScene.getState().nodes))
    const fit = computeAutoFit(segment, node, obstacles)
    if (!fit) {
      setAutoFitMessage(
        'No panel fits here. Move or rotate the array, or reduce the panel dimensions.',
      )
      return
    }
    updateNode(selectedId as AnyNode['id'], { rows: fit.rows, columns: fit.columns })
    setAutoFitMessage(null)
  }, [selectedId, node, segment, updateNode])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const segmentId = node.roofSegmentId
    deleteNode(selectedId as AnyNodeId)
    if (segmentId) {
      useScene.getState().dirtyNodes.add(segmentId as AnyNodeId)
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, deleteNode, setSelection])

  if (!(node && node.type === 'solar-panel' && selectedId)) return null

  const activePreset = node.panelTypePreset
  const formatDims = (w: number, h: number) => `${w.toFixed(2)} × ${h.toFixed(2)} m`

  return (
    <PanelWrapper
      icon="/icons/solar-panel.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Solar Panel'}
      width={300}
    >
      <PanelSection title="Style">
        <div className="grid grid-cols-2 gap-1.5 px-1 pt-1">
          {PRESET_CARDS.map((card) => {
            const dims = SOLAR_PANEL_PRESETS[card.key]
            const isSelected = activePreset === card.key
            return (
              <button
                className={cn(
                  'flex min-h-14 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                  isSelected
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-black/4 dark:bg-[#2C2C2E] text-muted-foreground hover:bg-black/8 dark:hover:bg-[#3e3e3e] hover:text-foreground',
                )}
                aria-pressed={isSelected}
                key={card.key}
                onClick={() => handlePresetChange(card.key)}
                type="button"
              >
                <img
                  alt=""
                  className="h-16 w-full object-contain"
                  src={`/icons/solar-panel/${card.key}.webp`}
                />
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="truncate">{card.label}</span>
                </span>
                <span className="text-[10px] tabular-nums opacity-70">
                  {formatDims(dims.panelWidth, dims.panelHeight)}
                </span>
              </button>
            )
          })}
        </div>
        {!activePreset && (
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">
            Custom — dimensions don't match any preset
          </p>
        )}
      </PanelSection>

      <PanelSection title="Array">
        <p className="px-1 text-xs text-muted-foreground">
          {node.rows * node.columns} panels ·{' '}
          {formatDims(
            node.columns * node.panelWidth + (node.columns - 1) * node.gapX,
            node.rows * node.panelHeight + (node.rows - 1) * node.gapY,
          )}
        </p>
        <SliderControl
          label="Rows"
          max={20}
          min={1}
          onChange={(v) => previewProp({ rows: Math.round(v) })}
          onCommit={(v) => commitProp({ rows: Math.round(v) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={num(node.rows, 4)}
        />
        <SliderControl
          label="Columns"
          max={20}
          min={1}
          onChange={(v) => previewProp({ columns: Math.round(v) })}
          onCommit={(v) => commitProp({ columns: Math.round(v) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={num(node.columns, 5)}
        />
        <SliderControl
          label="Column gap"
          max={0.2}
          min={0}
          onChange={(v) => previewProp({ gapX: v })}
          onCommit={(v) => commitProp({ gapX: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={num(node.gapX, 0.02)}
        />
        <SliderControl
          label="Row gap"
          max={0.2}
          min={0}
          onChange={(v) => previewProp({ gapY: v })}
          onCommit={(v) => commitProp({ gapY: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={num(node.gapY, 0.02)}
        />
        <ActionGroup>
          <ActionButton disabled={!segment} label="Auto-fit to roof" onClick={handleAutoFit} />
        </ActionGroup>
        {autoFitMessage ? (
          <p className="px-1 text-amber-700 dark:text-amber-400 text-xs">{autoFitMessage}</p>
        ) : null}
      </PanelSection>

      <PanelSection title="Panel">
        <SliderControl
          label="Width"
          min={0.3}
          onChange={(v) => previewProp({ panelWidth: v })}
          onCommit={(v) => commitProp({ panelWidth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={num(node.panelWidth, 1)}
        />
        <SliderControl
          label="Length"
          min={0.3}
          onChange={(v) => previewProp({ panelHeight: v })}
          onCommit={(v) => commitProp({ panelHeight: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={num(node.panelHeight, 1.65)}
        />
        <ActionGroup>
          <ActionButton label="Flip orientation" onClick={handleFlip} />
        </ActionGroup>
        <SliderControl
          label="Frame border"
          max={0.1}
          min={0.005}
          onChange={(v) => previewProp({ frameThickness: v })}
          onCommit={(v) => commitProp({ frameThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={num(node.frameThickness, 0.04)}
        />
        <SliderControl
          label="Frame depth"
          max={0.1}
          min={0.005}
          onChange={(v) => previewProp({ frameDepth: v })}
          onCommit={(v) => commitProp({ frameDepth: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={num(node.frameDepth, 0.04)}
        />
      </PanelSection>

      <PanelSection title="Mounting">
        <SegmentedControl
          onChange={(v) => handleUpdate({ mountingType: v })}
          options={[
            { label: 'Flush', value: 'flush' },
            { label: 'Tilted', value: 'tilted' },
          ]}
          value={node.mountingType ?? 'flush'}
        />
        {node.mountingType === 'tilted' && (
          <SliderControl
            label="Tilt angle"
            max={45}
            min={0}
            onChange={(v) => previewProp({ tiltAngle: v })}
            onCommit={(v) => commitProp({ tiltAngle: v })}
            precision={0}
            restoreOnCommit={false}
            step={1}
            unit="°"
            value={Math.round(num(node.tiltAngle, 15))}
          />
        )}
        <SliderControl
          label="Standoff"
          max={0.3}
          min={0}
          onChange={(v) => previewProp({ standoffHeight: v })}
          onCommit={(v) => commitProp({ standoffHeight: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={num(node.standoffHeight, 0.05)}
        />
      </PanelSection>

      <PanelSection title="Position" defaultExpanded={false}>
        <SliderControl
          label="Rotation"
          min={-180}
          max={180}
          unit="°"
          step={1}
          precision={0}
          restoreOnCommit={false}
          value={(node.rotation * 180) / Math.PI}
          onChange={(v) => previewProp({ rotation: (v * Math.PI) / 180 })}
          onCommit={(v) => commitProp({ rotation: (v * Math.PI) / 180 })}
        />
      </PanelSection>
      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
