'use client'

import {
  type AnyNode,
  COLUMN_PRESETS,
  type ColumnNode,
  type ColumnPresetId,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground outline-none transition-colors hover:bg-[#3e3e3e] focus:ring-1 focus:ring-border'

const COLUMN_PRESET_OPTIONS = Object.entries(COLUMN_PRESETS).map(([value, preset]) => ({
  value: value as ColumnPresetId,
  label: preset.label,
}))

const COLUMN_PROPORTION_PRESETS = {
  slender: {
    label: 'Slender',
    height: 3.6,
    width: 0.34,
    baseHeight: 0.18,
    capitalHeight: 0.16,
    baseWidthScale: 1.18,
    capitalWidthScale: 1.16,
    edgeSoftness: 0.02,
  },
  standard: {
    label: 'Standard',
    height: 2.9,
    width: 0.44,
    baseHeight: 0.22,
    capitalHeight: 0.2,
    baseWidthScale: 1.24,
    capitalWidthScale: 1.22,
    edgeSoftness: 0.025,
  },
  heavy: {
    label: 'Heavy',
    height: 3,
    width: 0.58,
    baseHeight: 0.28,
    capitalHeight: 0.26,
    baseWidthScale: 1.34,
    capitalWidthScale: 1.3,
    edgeSoftness: 0.035,
  },
  stout: {
    label: 'Short / Stout',
    height: 2.2,
    width: 0.62,
    baseHeight: 0.3,
    capitalHeight: 0.28,
    baseWidthScale: 1.38,
    capitalWidthScale: 1.34,
    edgeSoftness: 0.04,
  },
} as const

type ColumnProportionPresetId = keyof typeof COLUMN_PROPORTION_PRESETS

const COLUMN_PROPORTION_OPTIONS = Object.entries(COLUMN_PROPORTION_PRESETS).map(([value, preset]) => ({
  value: value as ColumnProportionPresetId,
  label: preset.label,
}))

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function presetUpdates(presetId: ColumnPresetId): Partial<ColumnNode> {
  const { label, ...preset } = COLUMN_PRESETS[presetId]
  return {
    name: label,
    ...preset,
  }
}

function proportionUpdates(
  node: ColumnNode,
  presetId: ColumnProportionPresetId,
): Partial<ColumnNode> {
  const preset = COLUMN_PROPORTION_PRESETS[presetId]
  const depth =
    node.crossSection === 'rectangular'
      ? clamp(preset.width * (node.depth / Math.max(node.width, 0.01)), 0.12, 1.6)
      : preset.width
  const shaftCornerRadius = Math.min(node.shaftCornerRadius ?? 0.035, preset.width * 0.18)

  return {
    height: preset.height,
    width: preset.width,
    depth,
    radius: preset.width / 2,
    baseHeight: preset.baseHeight,
    capitalHeight: preset.capitalHeight,
    baseWidthScale: preset.baseWidthScale,
    baseDepthScale: preset.baseWidthScale,
    capitalWidthScale: preset.capitalWidthScale,
    capitalDepthScale: preset.capitalWidthScale,
    edgeSoftness: preset.edgeSoftness,
    shaftCornerRadius,
  }
}

function shaftProfileUpdates(shaftProfile: ColumnNode['shaftProfile']): Partial<ColumnNode> {
  if (shaftProfile === 'tapered') {
    return {
      shaftProfile,
      shaftTaper: 0.14,
      shaftBulge: 0,
      shaftStartScale: 0.82,
      shaftEndScale: 0.72,
      shaftSegmentCount: 32,
    }
  }

  if (shaftProfile === 'bulged') {
    return {
      shaftProfile,
      shaftTaper: 0,
      shaftBulge: 0.12,
      shaftStartScale: 0.68,
      shaftEndScale: 0.68,
      shaftSegmentCount: 32,
    }
  }

  if (shaftProfile === 'hourglass') {
    return {
      shaftProfile,
      shaftTaper: 0,
      shaftBulge: 0.12,
      shaftStartScale: 0.84,
      shaftEndScale: 0.84,
      shaftSegmentCount: 32,
    }
  }

  return {
    shaftProfile,
    shaftTaper: 0,
    shaftBulge: 0,
    shaftStartScale: 0.72,
    shaftEndScale: 0.72,
    shaftSegmentCount: 1,
    shaftTwistStep: 0,
  }
}

export function ColumnPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as ColumnNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<ColumnNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    sfxEmitter.emit('sfx:structure-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, selectedId, setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  if (!(node && node.type === 'column' && selectedId && selectedCount === 1)) return null
  const shaftProfile = node.shaftProfile ?? 'straight'

  return (
    <PanelWrapper icon="/icons/column.png" onClose={handleClose} title={node.name || 'Column'} width={300}>
      <PanelSection title="Preset">
        <select
          className={SELECT_CLASS}
          onChange={(event) => {
            if (!event.target.value) return
            handleUpdate(presetUpdates(event.target.value as ColumnPresetId))
          }}
          value=""
        >
          <option value="">Apply preset...</option>
          {COLUMN_PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </PanelSection>

      <PanelSection title="Shape">
        <select
          className={SELECT_CLASS}
          onChange={(event) => handleUpdate({ crossSection: event.target.value as ColumnNode['crossSection'] })}
          value={node.crossSection}
        >
          <option value="round">Round</option>
          <option value="square">Square</option>
          <option value="rectangular">Rectangular</option>
        </select>
        <SliderControl
          label="Edge Softness"
          max={0.12}
          min={0}
          onChange={(value) => handleUpdate({ edgeSoftness: value })}
          precision={3}
          step={0.005}
          unit="m"
          value={node.edgeSoftness ?? 0.025}
        />
        {(node.crossSection === 'square' || node.crossSection === 'rectangular') && (
          <SliderControl
            label="Shaft Corner Radius"
            max={0.3}
            min={0}
            onChange={(value) => handleUpdate({ shaftCornerRadius: value })}
            precision={3}
            step={0.005}
            unit="m"
            value={node.shaftCornerRadius ?? 0.035}
          />
        )}
      </PanelSection>

      <PanelSection title="Dimensions">
        <select
          className={SELECT_CLASS}
          onChange={(event) => {
            if (!event.target.value) return
            handleUpdate(proportionUpdates(node, event.target.value as ColumnProportionPresetId))
          }}
          value=""
        >
          <option value="">Apply proportion...</option>
          {COLUMN_PROPORTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <SliderControl
          label="Height"
          max={6}
          min={0.8}
          onChange={(value) => handleUpdate({ height: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.height}
        />
        <SliderControl
          label="Width"
          max={1.6}
          min={0.12}
          onChange={(value) =>
            handleUpdate({
              width: value,
              radius: value / 2,
              ...(node.crossSection === 'rectangular' ? {} : { depth: value }),
            })
          }
          precision={2}
          step={0.02}
          unit="m"
          value={node.width}
        />
        {node.crossSection === 'rectangular' && (
          <SliderControl
            label="Depth"
            max={1.6}
            min={0.12}
            onChange={(value) => handleUpdate({ depth: value })}
            precision={2}
            step={0.02}
            unit="m"
            value={node.depth}
          />
        )}
      </PanelSection>

      <PanelSection title="Shaft">
        <select
          className={SELECT_CLASS}
          onChange={(event) => handleUpdate(shaftProfileUpdates(event.target.value as ColumnNode['shaftProfile']))}
          value={shaftProfile}
        >
          <option value="straight">Straight</option>
          <option value="tapered">Tapered</option>
          <option value="bulged">Bulged</option>
          <option value="hourglass">Hourglass</option>
        </select>
        {shaftProfile === 'straight' && (
          <SliderControl
            label="Shaft Width"
            max={1.2}
            min={0.3}
            onChange={(value) => handleUpdate({ shaftStartScale: value, shaftEndScale: value })}
            precision={2}
            step={0.02}
            value={node.shaftStartScale ?? 0.72}
          />
        )}
        {shaftProfile === 'tapered' && (
          <>
            <SliderControl
              label="Bottom Width"
              max={1.2}
              min={0.3}
              onChange={(value) => handleUpdate({ shaftStartScale: value })}
              precision={2}
              step={0.02}
              value={node.shaftStartScale ?? 0.82}
            />
            <SliderControl
              label="Top Width"
              max={1.2}
              min={0.3}
              onChange={(value) => handleUpdate({ shaftEndScale: value })}
              precision={2}
              step={0.02}
              value={node.shaftEndScale ?? 0.72}
            />
            <SliderControl
              label="Taper"
              max={0.45}
              min={0}
              onChange={(value) => handleUpdate({ shaftTaper: value })}
              precision={2}
              step={0.01}
              value={node.shaftTaper ?? 0.14}
            />
          </>
        )}
        {shaftProfile === 'bulged' && (
          <>
            <SliderControl
              label="End Width"
              max={1.2}
              min={0.3}
              onChange={(value) => handleUpdate({ shaftStartScale: value, shaftEndScale: value })}
              precision={2}
              step={0.02}
              value={node.shaftStartScale ?? 0.68}
            />
            <SliderControl
              label="Bulge"
              max={0.35}
              min={0}
              onChange={(value) => handleUpdate({ shaftBulge: value })}
              precision={2}
              step={0.01}
              value={node.shaftBulge ?? 0.12}
            />
          </>
        )}
        {shaftProfile === 'hourglass' && (
          <>
            <SliderControl
              label="End Width"
              max={1.2}
              min={0.3}
              onChange={(value) => handleUpdate({ shaftStartScale: value, shaftEndScale: value })}
              precision={2}
              step={0.02}
              value={node.shaftStartScale ?? 0.84}
            />
            <SliderControl
              label="Waist"
              max={0.35}
              min={0}
              onChange={(value) => handleUpdate({ shaftBulge: value })}
              precision={2}
              step={0.01}
              value={node.shaftBulge ?? 0.12}
            />
          </>
        )}
        <SliderControl
          label="Segment Twist"
          max={90}
          min={-90}
          onChange={(value) =>
            handleUpdate({
              shaftTwistStep: value,
              ...(Math.abs(value) > 0.001 && (node.shaftSegmentCount ?? 1) < 8
                ? { shaftSegmentCount: 12 }
                : {}),
            })
          }
          precision={0}
          step={5}
          unit="°"
          value={node.shaftTwistStep ?? 0}
        />
        {Math.abs(node.shaftTwistStep ?? 0) > 0.001 && (
          <SliderControl
            label="Twist Segments"
            max={48}
            min={4}
            onChange={(value) => handleUpdate({ shaftSegmentCount: Math.round(value) })}
            precision={0}
            step={1}
            value={node.shaftSegmentCount ?? 12}
          />
        )}
        <SliderControl
          label="Ring Pairs"
          max={4}
          min={0}
          onChange={(value) =>
            handleUpdate({
              ringCount: Math.round(value) * 2,
              ringPlacement: 'ends',
              ringSpread: node.ringSpread ?? 0.16,
              ringThickness: node.ringThickness ?? 0.055,
            })
          }
          precision={0}
          step={1}
          value={Math.ceil((node.ringCount ?? 0) / 2)}
        />
        {(node.ringCount ?? 0) > 0 && (
          <SliderControl
            label="Ring Thickness"
            max={0.14}
            min={0.01}
            onChange={(value) => handleUpdate({ ringThickness: value })}
            precision={3}
            step={0.005}
            unit="m"
            value={node.ringThickness ?? 0.055}
          />
        )}
        {(node.ringCount ?? 0) > 0 && (
          <SliderControl
            label="Ring Spread"
            max={0.45}
            min={0.04}
            onChange={(value) => handleUpdate({ ringSpread: value, ringPlacement: 'ends' })}
            precision={2}
            step={0.01}
            value={node.ringSpread ?? 0.16}
          />
        )}
      </PanelSection>

      <PanelSection title="Ends">
        <select
          className={SELECT_CLASS}
          onChange={(event) => {
            const capitalStyle = event.target.value as ColumnNode['capitalStyle']
            handleUpdate({
              capitalStyle,
              ...(capitalStyle === 'none'
                ? {}
                : {
                    capitalHeight: Math.max(node.capitalHeight, 0.12),
                    capitalTierCount: capitalStyle === 'stepped' ? Math.max(node.capitalTierCount ?? 3, 3) : node.capitalTierCount,
                    capitalWidthScale: Math.max(node.capitalWidthScale ?? 1.3, capitalStyle === 'stepped' ? 1.42 : 1.28),
                    capitalDepthScale: Math.max(node.capitalDepthScale ?? 1.3, capitalStyle === 'stepped' ? 1.42 : 1.28),
                    capitalStepSpread: capitalStyle === 'stepped' ? Math.max(node.capitalStepSpread ?? 0.34, 0.34) : node.capitalStepSpread,
                  }),
            })
          }}
          value={node.capitalStyle === 'simple-slab' ? 'simple' : (node.capitalStyle ?? 'simple')}
        >
          <option value="none">No Top</option>
          <option value="simple">Simple Top</option>
          <option value="stepped">Stepped Top</option>
          <option value="rounded">Rounded Top</option>
        </select>
        {node.capitalStyle !== 'none' && (
          <SliderControl
            label="Top Height"
            max={0.8}
            min={0.06}
            onChange={(value) => handleUpdate({ capitalHeight: value })}
            precision={2}
            step={0.02}
            unit="m"
            value={node.capitalHeight}
          />
        )}
        {node.capitalStyle !== 'none' && (
          <SliderControl
            label="Top Width"
            max={2.4}
            min={0.6}
            onChange={(value) =>
              handleUpdate({
                capitalWidthScale: value,
                ...(node.crossSection === 'rectangular' ? {} : { capitalDepthScale: value }),
              })
            }
            precision={2}
            step={0.02}
            value={node.capitalWidthScale ?? 1.28}
          />
        )}
        {node.capitalStyle !== 'none' && node.crossSection === 'rectangular' && (
          <SliderControl
            label="Top Depth"
            max={2.4}
            min={0.6}
            onChange={(value) => handleUpdate({ capitalDepthScale: value })}
            precision={2}
            step={0.02}
            value={node.capitalDepthScale ?? node.capitalWidthScale ?? 1.28}
          />
        )}
        {node.capitalStyle === 'stepped' && (
          <SliderControl
            label="Top Tiers"
            max={8}
            min={3}
            onChange={(value) => handleUpdate({ capitalTierCount: Math.round(value) })}
            precision={0}
            step={1}
            value={node.capitalTierCount ?? 3}
          />
        )}
        {node.capitalStyle === 'stepped' && (
          <SliderControl
            label="Top Step Spread"
            max={0.9}
            min={0.05}
            onChange={(value) => handleUpdate({ capitalStepSpread: value })}
            precision={2}
            step={0.01}
            value={node.capitalStepSpread ?? 0.34}
          />
        )}
        <select
          className={`${SELECT_CLASS} mt-2`}
          onChange={(event) => {
            const baseStyle = event.target.value as ColumnNode['baseStyle']
            handleUpdate({
              baseStyle,
              ...(baseStyle === 'none'
                ? {}
                : {
                    baseHeight: Math.max(node.baseHeight, 0.12),
                    baseTierCount: baseStyle === 'stepped-square' ? Math.max(node.baseTierCount ?? 3, 3) : node.baseTierCount,
                    baseWidthScale: Math.max(node.baseWidthScale ?? 1.24, baseStyle === 'stepped-square' ? 1.42 : 1.24),
                    baseDepthScale: Math.max(node.baseDepthScale ?? 1.24, baseStyle === 'stepped-square' ? 1.42 : 1.24),
                    baseStepSpread: baseStyle === 'stepped-square' ? Math.max(node.baseStepSpread ?? 0.34, 0.34) : node.baseStepSpread,
                    basePlinthHeightRatio: baseStyle === 'round-rings' ? (node.basePlinthHeightRatio ?? 0.44) : node.basePlinthHeightRatio,
                    baseRoundBandScale: baseStyle === 'round-rings' ? (node.baseRoundBandScale ?? 0.92) : node.baseRoundBandScale,
                    baseNeckScale: baseStyle === 'round-rings' ? (node.baseNeckScale ?? 0.72) : node.baseNeckScale,
                  }),
            })
          }}
          value={node.baseStyle ?? 'square-plinth'}
        >
          <option value="none">No Bottom</option>
          <option value="simple-square">Simple Block Bottom</option>
          <option value="square-plinth">Square Plinth Bottom</option>
          <option value="stepped-square">Stepped Bottom</option>
          <option value="round-rings">Rounded Bottom</option>
        </select>
        {node.baseStyle !== 'none' && (
          <SliderControl
            label="Bottom Height"
            max={0.8}
            min={0.06}
            onChange={(value) => handleUpdate({ baseHeight: value })}
            precision={2}
            step={0.02}
            unit="m"
            value={node.baseHeight}
          />
        )}
        {node.baseStyle !== 'none' && (
          <SliderControl
            label="Bottom Width"
            max={2.4}
            min={0.6}
            onChange={(value) =>
              handleUpdate({
                baseWidthScale: value,
                ...(node.crossSection === 'rectangular' ? {} : { baseDepthScale: value }),
              })
            }
            precision={2}
            step={0.02}
            value={node.baseWidthScale ?? 1.24}
          />
        )}
        {node.baseStyle !== 'none' && node.crossSection === 'rectangular' && (
          <SliderControl
            label="Bottom Depth"
            max={2.4}
            min={0.6}
            onChange={(value) => handleUpdate({ baseDepthScale: value })}
            precision={2}
            step={0.02}
            value={node.baseDepthScale ?? node.baseWidthScale ?? 1.24}
          />
        )}
        {node.baseStyle === 'round-rings' && (
          <SliderControl
            label="Plinth Thickness"
            max={0.7}
            min={0.2}
            onChange={(value) => handleUpdate({ basePlinthHeightRatio: value })}
            precision={2}
            step={0.01}
            value={node.basePlinthHeightRatio ?? 0.44}
          />
        )}
        {node.baseStyle === 'round-rings' && (
          <SliderControl
            label="Round Band Width"
            max={1.2}
            min={0.5}
            onChange={(value) => handleUpdate({ baseRoundBandScale: value })}
            precision={2}
            step={0.01}
            value={node.baseRoundBandScale ?? 0.92}
          />
        )}
        {node.baseStyle === 'round-rings' && (
          <SliderControl
            label="Neck Width"
            max={1}
            min={0.35}
            onChange={(value) => handleUpdate({ baseNeckScale: value })}
            precision={2}
            step={0.01}
            value={node.baseNeckScale ?? 0.72}
          />
        )}
        {node.baseStyle === 'stepped-square' && (
          <SliderControl
            label="Bottom Tiers"
            max={8}
            min={3}
            onChange={(value) => handleUpdate({ baseTierCount: Math.round(value) })}
            precision={0}
            step={1}
            value={node.baseTierCount ?? 3}
          />
        )}
        {node.baseStyle === 'stepped-square' && (
          <SliderControl
            label="Bottom Step Spread"
            max={0.9}
            min={0.05}
            onChange={(value) => handleUpdate({ baseStepSpread: value })}
            precision={2}
            step={0.01}
            value={node.baseStepSpread ?? 0.34}
          />
        )}
      </PanelSection>

      <PanelSection title="Transform">
        <SliderControl
          label="Yaw"
          max={180}
          min={-180}
          onChange={(value) => handleUpdate({ rotation: (value * Math.PI) / 180 })}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation * 180) / Math.PI)}
        />
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-4 w-4" />} label="Move" onClick={handleMove} />
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
