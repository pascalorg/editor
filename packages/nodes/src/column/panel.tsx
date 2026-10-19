'use client'

import {
  type AnyNode,
  type AnyNodeId,
  ColumnBaseStyle,
  ColumnCapitalStyle,
  ColumnCarvingPlacement,
  ColumnCrossSection,
  type ColumnNode,
  ColumnPanelShape,
  ColumnShaftDetail,
  ColumnShaftProfile,
  ColumnStyle,
  scriptImages,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  armMaterialPaint,
  PanelSection as BasePanelSection,
  SliderControl as BaseSliderControl,
  cn,
  PanelWrapper,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Move, PaintBucket, Trash2 } from 'lucide-react'
import { type ComponentProps, useCallback, useEffect, useMemo } from 'react'

import { AuthoredParams } from '../item/authored-params'
import { isManagedColumn } from './edit-policy'
import { planColumnEdit } from './hosted-resize'
import { ColumnInspectorHover } from './inspector-highlight'
import { ColumnPresetGallery } from './preset-gallery'
import { columnSectionReset } from './presets'
import { createColumnPropertyPreview } from './property-preview'

function PanelSection({
  part,
  ...props
}: ComponentProps<typeof BasePanelSection> & {
  part?: 'all' | 'shaft' | 'base' | 'capital' | 'frame'
}) {
  return (
    <div data-column-part={part}>
      <BasePanelSection {...props} />
    </div>
  )
}

function SliderControl({
  axis,
  ...props
}: ComponentProps<typeof BaseSliderControl> & { axis?: 'x' | 'y' | 'z' }) {
  return (
    <div data-column-axis={axis}>
      <BaseSliderControl {...props} />
    </div>
  )
}

const shapeLabel = (value: string) =>
  value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const detailFields = [
  ['fluteCount', 'Flute Count', 0, 32, 1],
  ['fluteDepth', 'Flute Depth', 0.005, 0.08, 0.005],
  ['fluteWidth', 'Flute Width', 0.005, 0.1, 0.005],
  ['spiralRibCount', 'Spiral Ribs', 0, 32, 1],
  ['spiralTwist', 'Spiral Turns', -3, 3, 0.1],
  ['panelCount', 'Carved Panels', 0, 24, 1],
  ['panelInsetDepth', 'Panel Relief', 0, 0.1, 0.005],
  ['latheRingCount', 'Lathe Rings', 0, 32, 1],
  ['voluteCount', 'Volutes', 0, 8, 1],
  ['voluteSize', 'Volute Size', 0.02, 0.3, 0.01],
  ['leafCount', 'Leaves', 0, 48, 1],
  ['leafRows', 'Leaf Rows', 0, 4, 1],
  ['bracketDepth', 'Bracket Depth', 0, 1.5, 0.01],
  ['bracketTierCount', 'Bracket Tiers', 0, 8, 1],
  ['pendantCount', 'Pendants', 0, 16, 1],
  ['baseRibCount', 'Base Ribs', 0, 48, 1],
  ['baseCarvingLevel', 'Base Carving', 0, 4, 1],
  ['capitalCarvingLevel', 'Capital Carving', 0, 4, 1],
] as const

const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-sm text-foreground outline-none transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e] focus:ring-1 focus:ring-border'

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

const COLUMN_PROPORTION_OPTIONS = Object.entries(COLUMN_PROPORTION_PRESETS).map(
  ([value, preset]) => ({
    value: value as ColumnProportionPresetId,
    label: preset.label,
  }),
)

const SUPPORT_STYLE_OPTIONS: Array<{ label: string; value: ColumnNode['supportStyle'] }> = [
  { label: 'Vertical', value: 'vertical' },
  { label: 'A-Frame', value: 'a-frame' },
  { label: 'Y Support', value: 'y-frame' },
  { label: 'V Support', value: 'v-frame' },
  { label: 'X Brace', value: 'x-brace' },
  { label: 'K Brace', value: 'k-brace' },
  { label: 'Single Strut', value: 'single-strut' },
  { label: 'Tripod', value: 'tripod' },
  { label: 'Trestle', value: 'trestle' },
  { label: 'Portal Frame', value: 'portal-frame' },
  { label: 'Box Frame', value: 'box-frame' },
]

type NonVerticalSupportStyle = Exclude<ColumnNode['supportStyle'], 'vertical'>

// Per-style brace defaults. Values mirror each support's renderer
// fall-through expressions so switching styles snaps the column to the
// shape that style was designed around — e.g. an A-frame opens wide at
// the foot and pinches at the top, an X-brace runs parallel legs, a
// tripod's "bottomSpread" / "topSpread" double as its X-span / Z-span.
// Without these, a user who customised one style (say A-frame bottom =
// 2.0) then switched to Y-frame would carry that 2.0 around in state
// even though Y-frame doesn't use it — and switching back to X-brace
// would inherit the leftover 0.12 top from A-frame, making the X look
// pinched.
const SUPPORT_STYLE_DEFAULTS: Record<NonVerticalSupportStyle, Partial<ColumnNode>> = {
  'a-frame': {
    braceBottomSpread: 1.4,
    braceTopSpread: 0.12,
    braceWidth: 0.16,
    braceDepth: 0.16,
  },
  'y-frame': {
    braceBottomSpread: 0.2,
    braceTopSpread: 0.9,
    braceWidth: 0.16,
    braceDepth: 0.16,
  },
  'v-frame': {
    braceBottomSpread: 0.2,
    braceTopSpread: 1.0,
    braceWidth: 0.16,
    braceDepth: 0.16,
  },
  'x-brace': {
    braceBottomSpread: 1.0,
    braceTopSpread: 1.0,
    braceWidth: 0.14,
    braceDepth: 0.14,
  },
  'k-brace': {
    braceBottomSpread: 1.0,
    braceTopSpread: 1.0,
    braceWidth: 0.14,
    braceDepth: 0.14,
  },
  'single-strut': {
    braceBottomSpread: 0.6,
    braceTopSpread: 0.6,
    braceWidth: 0.12,
    braceDepth: 0.12,
  },
  tripod: {
    // bottomSpread = X span, topSpread = Z span (tripod's three legs).
    braceBottomSpread: 1.1,
    braceTopSpread: 1.1,
    braceWidth: 0.12,
    braceDepth: 0.12,
  },
  trestle: {
    braceBottomSpread: 1.2,
    braceTopSpread: 1.0,
    braceWidth: 0.16,
    braceDepth: 0.16,
  },
  'portal-frame': {
    braceBottomSpread: 1.4,
    braceTopSpread: 1.0,
    braceWidth: 0.16,
    braceDepth: 0.16,
  },
  'box-frame': {
    // bottomSpread = X span, topSpread = Z span (rectangular footprint).
    braceBottomSpread: 1.4,
    braceTopSpread: 1.0,
    braceWidth: 0.16,
    braceDepth: 0.16,
  },
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

  if (shaftProfile === 'bulged' || shaftProfile === 'baluster') {
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

export default function ColumnPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNodes = useScene((s) => s.updateNodes)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storedNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as ColumnNode | undefined) : undefined,
  )

  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? s.overrides.get(selectedId as AnyNode['id']) : undefined,
  )
  const node =
    storedNode && overrides ? ({ ...storedNode, ...overrides } as ColumnNode) : storedNode
  const preview = useMemo(
    () => (selectedId ? createColumnPropertyPreview(selectedId as AnyNode['id']) : null),
    [selectedId],
  )
  useEffect(() => () => preview?.cancel(), [preview])
  const previewProp = useCallback(
    (updates: Partial<ColumnNode>) => preview?.preview(updates),
    [preview],
  )
  const commitPreview = useCallback(() => preview?.commit(), [preview])
  const cancelPreview = useCallback(() => preview?.cancel(), [preview])
  const handleUpdate = useCallback(
    (updates: Partial<ColumnNode>) => {
      if (!selectedId) return
      preview?.cancel()
      const updatesToApply = planColumnEdit(selectedId as AnyNode['id'], updates)
      if (updatesToApply) updateNodes(updatesToApply.map(([id, data]) => ({ id, data })))
    },
    [selectedId, updateNodes, preview],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    triggerSFX('sfx:structure-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, selectedId, setSelection])

  const handleMove = useCallback(() => {
    if (!node || isManagedColumn(node)) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  if (!(node && node.type === 'column' && selectedId && selectedCount === 1)) return null
  const shaftProfile = node.shaftProfile ?? 'straight'
  const radialSection = ['round', 'octagonal', 'sixteen-sided'].includes(node.crossSection)
  const spatialFrame = ['tripod', 'trestle', 'box-frame'].includes(node.supportStyle)
  const supportStyle = node.supportStyle ?? 'vertical'
  const managedByLeanTo = isManagedColumn(node)
  const isBraceSupport =
    supportStyle === 'a-frame' ||
    supportStyle === 'y-frame' ||
    supportStyle === 'v-frame' ||
    supportStyle === 'x-brace' ||
    supportStyle === 'k-brace' ||
    supportStyle === 'single-strut' ||
    supportStyle === 'tripod' ||
    supportStyle === 'trestle' ||
    supportStyle === 'portal-frame' ||
    supportStyle === 'box-frame'

  const renderDetails = (fields: readonly (typeof detailFields)[number][]) =>
    fields.map(([field, label, min, max, step]) => (
      <SliderControl
        key={field}
        label={label}
        min={min}
        max={max}
        step={step}
        precision={step === 1 ? 0 : 3}
        unit={field === 'spiralTwist' ? 'turns' : step === 1 ? '' : 'm'}
        value={node[field]}
        onChange={(value) => previewProp({ [field]: value })}
        onCommit={commitPreview}
        onCancel={cancelPreview}
        restoreOnCommit={false}
      />
    ))

  const hasPanels =
    node.panelCount > 0 || node.style === 'dravidian-carved' || node.shaftDetail === 'panelled'
  const shaftFields = detailFields.filter(([field]) => {
    if (field.startsWith('flute'))
      return node.crossSection === 'round' && (node.fluteCount > 0 || node.shaftDetail === 'fluted')
    if (field.startsWith('spiral')) return node.spiralRibCount > 0 || node.shaftDetail === 'spiral'
    if (field.startsWith('panel')) return hasPanels
    if (field === 'latheRingCount')
      return node.latheRingCount > 0 || node.shaftDetail === 'lathe-turned'
    return false
  })
  const capitalFields = detailFields.filter(([field]) => {
    if (node.capitalStyle === 'none') return false
    if (field.startsWith('volute')) return ['volute', 'ionic-volute'].includes(node.capitalStyle)
    if (field.startsWith('leaf'))
      return ['leaf-carved', 'corinthian-leaf'].includes(node.capitalStyle)
    if (field.startsWith('bracket') || field === 'pendantCount')
      return ['south-indian-bracket', 'wood-bracket'].includes(node.capitalStyle)
    return field === 'capitalCarvingLevel' && ['capital', 'all'].includes(node.carvingPlacement)
  })
  const baseFields = detailFields.filter(
    ([field]) =>
      node.baseStyle !== 'none' &&
      ((field === 'baseRibCount' && ['lotus', 'ribbed-lotus'].includes(node.baseStyle)) ||
        (field === 'baseCarvingLevel' && ['base', 'all'].includes(node.carvingPlacement))),
  )

  return (
    <PanelWrapper
      icon={scriptImages(node)?.thumbnail ?? '/icons/column.webp'}
      onClose={handleClose}
      title={node.name || 'Column'}
      width={300}
    >
      <ColumnInspectorHover nodeId={selectedId as AnyNodeId}>
        {node.source ? (
          <div data-column-part="all">
            <AuthoredParams node={node} />
          </div>
        ) : (
          <>
            <PanelSection part="all" title="Shape">
              <button
                type="button"
                className="self-end text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleUpdate(columnSectionReset('Shape'))}
              >
                Reset shape
              </button>
              <ColumnPresetGallery
                onPreview={previewProp}
                onCancel={cancelPreview}
                onApply={handleUpdate}
              />
              <div className="grid grid-cols-2 gap-2 px-1 pt-1">
                {SUPPORT_STYLE_OPTIONS.map((option) => {
                  const isSelected = supportStyle === option.value
                  return (
                    <button
                      className={cn(
                        'flex min-h-12 items-center rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                        isSelected
                          ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                          : 'border-border/50 bg-black/4 dark:bg-[#2C2C2E] text-muted-foreground hover:bg-black/8 dark:hover:bg-[#3e3e3e] hover:text-foreground',
                      )}
                      key={option.value}
                      onClick={() => {
                        // Per-style brace defaults reset the column to that
                        // style's natural proportions on switch. Spread last
                        // so the preset's braceWidth / braceDepth win over
                        // the carried-from-previous-style values.
                        const stylePreset =
                          option.value === 'vertical' ? {} : SUPPORT_STYLE_DEFAULTS[option.value]
                        handleUpdate({
                          supportStyle: option.value,
                          ...(option.value !== 'vertical'
                            ? {
                                crossSection: 'rectangular',
                                width: node.braceWidth ?? node.width,
                                depth: node.braceDepth ?? node.depth,
                                baseStyle: 'none',
                                capitalStyle: 'none',
                              }
                            : {}),
                          ...stylePreset,
                        })
                      }}
                      type="button"
                    >
                      <span className="truncate font-medium">{option.label}</span>
                    </button>
                  )
                })}
              </div>
              {!isBraceSupport && (
                <>
                  <p className="text-xs text-muted-foreground">Style</p>
                  <select
                    aria-label="Column style"
                    className={SELECT_CLASS}
                    value={node.style}
                    onChange={(event) =>
                      handleUpdate({ style: ColumnStyle.parse(event.target.value) })
                    }
                  >
                    {ColumnStyle.options.map((value) => (
                      <option key={value} value={value}>
                        {shapeLabel(value)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">Cross section</p>
                  <select
                    aria-label="Cross section"
                    className={SELECT_CLASS}
                    value={node.crossSection}
                    onChange={(event) =>
                      handleUpdate({ crossSection: ColumnCrossSection.parse(event.target.value) })
                    }
                  >
                    {ColumnCrossSection.options.map((value) => (
                      <option key={value} value={value}>
                        {shapeLabel(value)}
                      </option>
                    ))}
                  </select>
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label="Edge Softness"
                    max={0.12}
                    min={0}
                    onChange={(value) => previewProp({ edgeSoftness: value })}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={node.edgeSoftness ?? 0.025}
                  />
                  {(node.crossSection === 'square' || node.crossSection === 'rectangular') && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Shaft Corner Radius"
                      max={0.3}
                      min={0}
                      onChange={(value) => previewProp({ shaftCornerRadius: value })}
                      precision={3}
                      step={0.005}
                      unit="m"
                      value={node.shaftCornerRadius ?? 0.035}
                    />
                  )}
                </>
              )}
            </PanelSection>

            <PanelSection part="all" title="Size">
              <button
                type="button"
                className="self-end text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleUpdate(columnSectionReset('Size'))}
              >
                Reset size
              </button>
              {isBraceSupport && (
                <>
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label="Member Width"
                    axis="x"
                    max={1000}
                    min={0.04}
                    onChange={(value) => previewProp({ braceWidth: value, width: value })}
                    precision={2}
                    step={0.01}
                    unit="m"
                    value={node.braceWidth ?? node.width}
                  />
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label="Member Depth"
                    axis="z"
                    max={1000}
                    min={0.04}
                    onChange={(value) => previewProp({ braceDepth: value, depth: value })}
                    precision={2}
                    step={0.01}
                    unit="m"
                    value={node.braceDepth ?? node.depth}
                  />
                </>
              )}
              {managedByLeanTo && (
                <p className="px-1 pt-1 text-muted-foreground text-xs leading-relaxed">
                  Height and footprint are controlled by the lean-to extension. Rotate or change the
                  support style here; resize from the parent lean-to.
                </p>
              )}
              {!isBraceSupport && !managedByLeanTo && (
                <select
                  aria-label="Column proportions"
                  className={SELECT_CLASS}
                  onChange={(event) => {
                    if (!event.target.value) return
                    handleUpdate(
                      proportionUpdates(node, event.target.value as ColumnProportionPresetId),
                    )
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
              )}
              {!managedByLeanTo && (
                <SliderControl
                  onCommit={commitPreview}
                  onCancel={cancelPreview}
                  restoreOnCommit={false}
                  label="Height"
                  axis="y"
                  max={1000}
                  min={0.2}
                  onChange={(value) => previewProp({ height: value })}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={node.height}
                />
              )}
              {isBraceSupport ? (
                <>
                  {(supportStyle === 'a-frame' ||
                    supportStyle === 'x-brace' ||
                    supportStyle === 'k-brace' ||
                    supportStyle === 'single-strut' ||
                    supportStyle === 'tripod' ||
                    supportStyle === 'trestle' ||
                    supportStyle === 'portal-frame' ||
                    supportStyle === 'box-frame') && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      axis="x"
                      label={
                        spatialFrame || supportStyle === 'portal-frame'
                          ? 'Width Span'
                          : 'Bottom Spread'
                      }
                      max={1000}
                      min={0.2}
                      onChange={(value) =>
                        previewProp({
                          braceBottomSpread: value,
                          braceTopSpread:
                            supportStyle === 'a-frame'
                              ? Math.min(node.braceTopSpread ?? 0.12, value)
                              : (node.braceTopSpread ?? 1),
                        })
                      }
                      precision={2}
                      step={0.05}
                      unit="m"
                      value={node.braceBottomSpread ?? 1.2}
                    />
                  )}
                  {supportStyle !== 'portal-frame' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      axis={spatialFrame ? 'z' : 'x'}
                      label={
                        spatialFrame
                          ? 'Depth Span'
                          : supportStyle === 'y-frame' || supportStyle === 'v-frame'
                            ? 'Fork Spread'
                            : 'Top Spread'
                      }
                      max={
                        supportStyle === 'y-frame' ||
                        supportStyle === 'v-frame' ||
                        supportStyle === 'x-brace' ||
                        supportStyle === 'k-brace' ||
                        supportStyle === 'single-strut' ||
                        supportStyle === 'tripod' ||
                        supportStyle === 'trestle' ||
                        supportStyle === 'box-frame'
                          ? 1000
                          : Math.max(0.2, node.braceBottomSpread ?? 1.2)
                      }
                      min={0}
                      onChange={(value) => previewProp({ braceTopSpread: value })}
                      precision={2}
                      step={0.02}
                      unit="m"
                      value={
                        node.braceTopSpread ??
                        (supportStyle === 'y-frame' ||
                        supportStyle === 'v-frame' ||
                        supportStyle === 'x-brace' ||
                        supportStyle === 'k-brace' ||
                        supportStyle === 'single-strut' ||
                        supportStyle === 'tripod' ||
                        supportStyle === 'trestle' ||
                        supportStyle === 'box-frame'
                          ? 1
                          : 0.12)
                      }
                    />
                  )}
                  <ToggleControl
                    checked={node.bracePlateEnabled ?? true}
                    label="Connector Plates"
                    onChange={(checked) => handleUpdate({ bracePlateEnabled: checked })}
                  />
                </>
              ) : !managedByLeanTo ? (
                <>
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label={radialSection ? 'Diameter' : 'Width'}
                    axis="x"
                    max={1000}
                    min={0.1}
                    onChange={(value) =>
                      previewProp({
                        width: value,
                        radius: value / 2,
                        ...(node.crossSection === 'rectangular' ? {} : { depth: value }),
                      })
                    }
                    precision={2}
                    step={0.02}
                    unit="m"
                    value={radialSection ? node.radius * 2 : node.width}
                  />
                  {node.crossSection === 'rectangular' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Depth"
                      axis="z"
                      max={1000}
                      min={0.1}
                      onChange={(value) => previewProp({ depth: value })}
                      precision={2}
                      step={0.02}
                      unit="m"
                      value={node.depth}
                    />
                  )}
                </>
              ) : null}
            </PanelSection>

            {!isBraceSupport && node.style !== 'cluster' && (
              <PanelSection part="shaft" title="Profile">
                <button
                  type="button"
                  className="self-end text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleUpdate(columnSectionReset('Profile'))}
                >
                  Reset profile
                </button>
                <p className="text-xs text-muted-foreground">
                  Scales multiply the dimensions in Size. A ratio of 0.2 means 20%.
                </p>
                <select
                  aria-label="Shaft profile"
                  className={SELECT_CLASS}
                  onChange={(event) =>
                    handleUpdate(
                      shaftProfileUpdates(event.target.value as ColumnNode['shaftProfile']),
                    )
                  }
                  value={shaftProfile}
                >
                  {ColumnShaftProfile.options.map((value) => (
                    <option key={value} value={value}>
                      {shapeLabel(value)}
                    </option>
                  ))}
                </select>
                {shaftProfile === 'straight' && (
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label="Shaft Scale"
                    unit="×"
                    max={2}
                    min={0.2}
                    onChange={(value) =>
                      previewProp({ shaftStartScale: value, shaftEndScale: value })
                    }
                    precision={2}
                    step={0.02}
                    value={node.shaftStartScale ?? 0.72}
                  />
                )}
                {shaftProfile === 'tapered' && (
                  <>
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Bottom Scale"
                      unit="×"
                      max={2}
                      min={0.2}
                      onChange={(value) => previewProp({ shaftStartScale: value })}
                      precision={2}
                      step={0.02}
                      value={node.shaftStartScale ?? 0.82}
                    />
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Top Scale"
                      unit="×"
                      max={2}
                      min={0.2}
                      onChange={(value) => previewProp({ shaftEndScale: value })}
                      precision={2}
                      step={0.02}
                      value={node.shaftEndScale ?? 0.72}
                    />
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Taper Ratio"
                      max={0.85}
                      min={0}
                      onChange={(value) => previewProp({ shaftTaper: value })}
                      precision={2}
                      step={0.01}
                      value={node.shaftTaper ?? 0.14}
                    />
                  </>
                )}
                {(shaftProfile === 'bulged' || shaftProfile === 'baluster') && (
                  <>
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="End Scale"
                      unit="×"
                      max={2}
                      min={0.2}
                      onChange={(value) =>
                        previewProp({ shaftStartScale: value, shaftEndScale: value })
                      }
                      precision={2}
                      step={0.02}
                      value={node.shaftStartScale ?? 0.68}
                    />
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Bulge Ratio"
                      max={0.8}
                      min={-0.5}
                      onChange={(value) => previewProp({ shaftBulge: value })}
                      precision={2}
                      step={0.01}
                      value={node.shaftBulge ?? 0.12}
                    />
                  </>
                )}
                {shaftProfile === 'hourglass' && (
                  <>
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="End Scale"
                      unit="×"
                      max={2}
                      min={0.2}
                      onChange={(value) =>
                        previewProp({ shaftStartScale: value, shaftEndScale: value })
                      }
                      precision={2}
                      step={0.02}
                      value={node.shaftStartScale ?? 0.84}
                    />
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Waist Reduction Ratio"
                      max={0.8}
                      min={-0.5}
                      onChange={(value) => previewProp({ shaftBulge: value })}
                      precision={2}
                      step={0.01}
                      value={node.shaftBulge ?? 0.12}
                    />
                  </>
                )}
                <SliderControl
                  onCommit={commitPreview}
                  onCancel={cancelPreview}
                  restoreOnCommit={false}
                  label="Twist per Segment"
                  max={90}
                  min={-90}
                  onChange={(value) =>
                    previewProp({
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
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label="Twist Segments"
                    max={64}
                    min={4}
                    onChange={(value) => previewProp({ shaftSegmentCount: Math.round(value) })}
                    precision={0}
                    step={1}
                    value={node.shaftSegmentCount ?? 12}
                  />
                )}
              </PanelSection>
            )}

            {!isBraceSupport && (
              <>
                <PanelSection part="base" title="Base">
                  <button
                    type="button"
                    className="self-end text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleUpdate(columnSectionReset('Base'))}
                  >
                    Reset base
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Width and depth scales use Size. Band and neck scales use the base footprint.
                  </p>
                  <select
                    aria-label="Base style"
                    className={`${SELECT_CLASS} mt-2`}
                    onChange={(event) => {
                      const baseStyle = event.target.value as ColumnNode['baseStyle']
                      handleUpdate({
                        baseStyle,
                        ...(baseStyle === 'none'
                          ? {}
                          : {
                              baseHeight: Math.max(node.baseHeight, 0.12),
                              baseTierCount:
                                baseStyle === 'stepped-square'
                                  ? Math.max(node.baseTierCount ?? 3, 3)
                                  : node.baseTierCount,
                              baseWidthScale: Math.max(
                                node.baseWidthScale ?? 1.24,
                                baseStyle === 'stepped-square' ? 1.42 : 1.24,
                              ),
                              baseDepthScale: Math.max(
                                node.baseDepthScale ?? 1.24,
                                baseStyle === 'stepped-square' ? 1.42 : 1.24,
                              ),
                              baseStepSpread:
                                baseStyle === 'stepped-square'
                                  ? Math.max(node.baseStepSpread ?? 0.34, 0.34)
                                  : node.baseStepSpread,
                              basePlinthHeightRatio:
                                baseStyle === 'round-rings'
                                  ? (node.basePlinthHeightRatio ?? 0.44)
                                  : node.basePlinthHeightRatio,
                              baseRoundBandScale:
                                baseStyle === 'round-rings'
                                  ? (node.baseRoundBandScale ?? 0.92)
                                  : node.baseRoundBandScale,
                              baseNeckScale:
                                baseStyle === 'round-rings'
                                  ? (node.baseNeckScale ?? 0.72)
                                  : node.baseNeckScale,
                            }),
                      })
                    }}
                    value={node.baseStyle ?? 'square-plinth'}
                  >
                    {ColumnBaseStyle.options.map((value) => (
                      <option key={value} value={value}>
                        {shapeLabel(value)}
                      </option>
                    ))}
                  </select>
                  {node.baseStyle !== 'none' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Base Height"
                      axis="y"
                      max={node.height * 0.4}
                      min={0}
                      onChange={(value) => previewProp({ baseHeight: value })}
                      precision={2}
                      step={0.02}
                      unit="m"
                      value={node.baseHeight}
                    />
                  )}
                  {node.baseStyle !== 'none' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Width Scale"
                      axis="x"
                      unit="×"
                      max={3}
                      min={0.4}
                      onChange={(value) =>
                        previewProp({
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
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Depth Scale"
                      axis="z"
                      unit="×"
                      max={3}
                      min={0.4}
                      onChange={(value) => previewProp({ baseDepthScale: value })}
                      precision={2}
                      step={0.02}
                      value={node.baseDepthScale ?? node.baseWidthScale ?? 1.24}
                    />
                  )}
                  {node.baseStyle === 'round-rings' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Plinth Height Fraction"
                      max={0.7}
                      min={0.2}
                      onChange={(value) => previewProp({ basePlinthHeightRatio: value })}
                      precision={2}
                      step={0.01}
                      value={node.basePlinthHeightRatio ?? 0.44}
                    />
                  )}
                  {node.baseStyle === 'round-rings' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Band Scale"
                      unit="×"
                      max={1.2}
                      min={0.5}
                      onChange={(value) => previewProp({ baseRoundBandScale: value })}
                      precision={2}
                      step={0.01}
                      value={node.baseRoundBandScale ?? 0.92}
                    />
                  )}
                  {node.baseStyle === 'round-rings' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Neck Scale"
                      unit="×"
                      max={1}
                      min={0.35}
                      onChange={(value) => previewProp({ baseNeckScale: value })}
                      precision={2}
                      step={0.01}
                      value={node.baseNeckScale ?? 0.72}
                    />
                  )}
                  {node.baseStyle === 'stepped-square' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Tier Count"
                      max={8}
                      min={3}
                      onChange={(value) => previewProp({ baseTierCount: Math.round(value) })}
                      precision={0}
                      step={1}
                      value={node.baseTierCount ?? 3}
                    />
                  )}
                  {node.baseStyle === 'stepped-square' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Step Scale Reduction"
                      unit="×"
                      max={0.9}
                      min={0.05}
                      onChange={(value) => previewProp({ baseStepSpread: value })}
                      precision={2}
                      step={0.01}
                      value={node.baseStepSpread ?? 0.34}
                    />
                  )}
                  {renderDetails(baseFields)}
                </PanelSection>
                <PanelSection part="capital" title="Capital">
                  <button
                    type="button"
                    className="self-end text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleUpdate(columnSectionReset('Capital'))}
                  >
                    Reset capital
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Width and depth scales multiply the dimensions in Size.
                  </p>
                  <select
                    aria-label="Capital style"
                    className={SELECT_CLASS}
                    onChange={(event) => {
                      const capitalStyle = event.target.value as ColumnNode['capitalStyle']
                      handleUpdate({
                        capitalStyle,
                        ...(capitalStyle === 'none'
                          ? {}
                          : {
                              capitalHeight: Math.max(node.capitalHeight, 0.12),
                              capitalTierCount:
                                capitalStyle === 'stepped'
                                  ? Math.max(node.capitalTierCount ?? 3, 3)
                                  : node.capitalTierCount,
                              capitalWidthScale: Math.max(
                                node.capitalWidthScale ?? 1.3,
                                capitalStyle === 'stepped' ? 1.42 : 1.28,
                              ),
                              capitalDepthScale: Math.max(
                                node.capitalDepthScale ?? 1.3,
                                capitalStyle === 'stepped' ? 1.42 : 1.28,
                              ),
                              capitalStepSpread:
                                capitalStyle === 'stepped'
                                  ? Math.max(node.capitalStepSpread ?? 0.34, 0.34)
                                  : node.capitalStepSpread,
                            }),
                      })
                    }}
                    value={node.capitalStyle}
                  >
                    {ColumnCapitalStyle.options.map((value) => (
                      <option key={value} value={value}>
                        {shapeLabel(value)}
                      </option>
                    ))}
                  </select>
                  {node.capitalStyle !== 'none' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Capital Height"
                      axis="y"
                      max={node.height * 0.4}
                      min={0}
                      onChange={(value) => previewProp({ capitalHeight: value })}
                      precision={2}
                      step={0.02}
                      unit="m"
                      value={node.capitalHeight}
                    />
                  )}
                  {node.capitalStyle !== 'none' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Width Scale"
                      axis="x"
                      unit="×"
                      max={3}
                      min={0.4}
                      onChange={(value) =>
                        previewProp({
                          capitalWidthScale: value,
                          ...(node.crossSection === 'rectangular'
                            ? {}
                            : { capitalDepthScale: value }),
                        })
                      }
                      precision={2}
                      step={0.02}
                      value={node.capitalWidthScale ?? 1.28}
                    />
                  )}
                  {node.capitalStyle !== 'none' && node.crossSection === 'rectangular' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Depth Scale"
                      axis="z"
                      unit="×"
                      max={3}
                      min={0.4}
                      onChange={(value) => previewProp({ capitalDepthScale: value })}
                      precision={2}
                      step={0.02}
                      value={node.capitalDepthScale ?? node.capitalWidthScale ?? 1.28}
                    />
                  )}
                  {node.capitalStyle === 'stepped' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Tier Count"
                      max={8}
                      min={3}
                      onChange={(value) => previewProp({ capitalTierCount: Math.round(value) })}
                      precision={0}
                      step={1}
                      value={node.capitalTierCount ?? 3}
                    />
                  )}
                  {node.capitalStyle === 'stepped' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label="Step Scale Reduction"
                      unit="×"
                      max={0.9}
                      min={0.05}
                      onChange={(value) => previewProp({ capitalStepSpread: value })}
                      precision={2}
                      step={0.01}
                      value={node.capitalStepSpread ?? 0.34}
                    />
                  )}
                  {renderDetails(capitalFields)}
                </PanelSection>
              </>
            )}
            {!isBraceSupport && (
              <PanelSection part="shaft" title="Surface Details">
                <button
                  type="button"
                  className="self-end text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleUpdate(columnSectionReset('Surface Details'))}
                >
                  Reset surface details
                </button>
                <p className="text-xs text-muted-foreground">Shaft detail</p>
                <select
                  aria-label="Shaft detail"
                  className={SELECT_CLASS}
                  value={node.shaftDetail}
                  onChange={(event) =>
                    handleUpdate({ shaftDetail: ColumnShaftDetail.parse(event.target.value) })
                  }
                >
                  {ColumnShaftDetail.options.map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={value === 'fluted' && node.crossSection !== 'round'}
                    >
                      {shapeLabel(value)}
                    </option>
                  ))}
                </select>
                {hasPanels && (
                  <>
                    <p className="text-xs text-muted-foreground">Panel shape</p>
                    <select
                      aria-label="Panel shape"
                      className={SELECT_CLASS}
                      value={node.panelShape}
                      onChange={(event) =>
                        handleUpdate({ panelShape: ColumnPanelShape.parse(event.target.value) })
                      }
                    >
                      {ColumnPanelShape.options.map((value) => (
                        <option key={value} value={value}>
                          {shapeLabel(value)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {renderDetails(shaftFields)}
                <SliderControl
                  onCommit={commitPreview}
                  onCancel={cancelPreview}
                  restoreOnCommit={false}
                  label="Ring Pairs"
                  max={8}
                  min={0}
                  onChange={(value) =>
                    previewProp({
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
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label="Ring Thickness"
                    max={0.14}
                    min={0.01}
                    onChange={(value) => previewProp({ ringThickness: value })}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={node.ringThickness ?? 0.055}
                  />
                )}
                {(node.ringCount ?? 0) > 0 && (
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label="Ring Spread Ratio"
                    max={0.45}
                    min={0.04}
                    onChange={(value) => previewProp({ ringSpread: value, ringPlacement: 'ends' })}
                    precision={2}
                    step={0.01}
                    value={node.ringSpread ?? 0.16}
                  />
                )}
                {(node.baseStyle !== 'none' || node.capitalStyle !== 'none') && (
                  <>
                    <p className="text-xs text-muted-foreground">Carving placement</p>
                    <select
                      aria-label="Carving placement"
                      className={SELECT_CLASS}
                      value={node.carvingPlacement}
                      onChange={(event) =>
                        handleUpdate({
                          carvingPlacement: ColumnCarvingPlacement.parse(event.target.value),
                        })
                      }
                    >
                      {ColumnCarvingPlacement.options.map((value) => (
                        <option key={value} value={value}>
                          {shapeLabel(value)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </PanelSection>
            )}
          </>
        )}
        <PanelSection title="Materials" defaultExpanded={false}>
          <button
            type="button"
            className="self-end text-xs text-muted-foreground hover:text-foreground"
            onClick={() => handleUpdate(columnSectionReset('Materials'))}
          >
            Reset materials
          </button>
          <p className="text-xs text-muted-foreground">
            Choose a material, then click the surface to paint.
          </p>
          <div className="flex flex-wrap gap-1">
            {(node.source
              ? ['all']
              : isBraceSupport
                ? ['frame']
                : [
                    'shaft',
                    ...(node.baseStyle !== 'none' ? ['base'] : []),
                    ...(node.capitalStyle !== 'none' ? ['capital'] : []),
                  ]
            ).map((part) => (
              <button
                key={part}
                type="button"
                data-column-part={part}
                className="rounded border border-border px-2 py-1 text-xs"
                onClick={() => {
                  cancelPreview()
                  armMaterialPaint(undefined, 'surface')
                }}
              >
                {part === 'all' ? 'Entire Object' : shapeLabel(part)}
              </button>
            ))}
          </div>
          <ActionButton
            icon={<PaintBucket className="h-4 w-4" />}
            label="Paint Materials"
            onClick={() => {
              cancelPreview()
              armMaterialPaint(undefined, 'surface')
            }}
          />
        </PanelSection>
        <PanelSection part="all" title="Transform">
          <button
            type="button"
            className="self-end text-xs text-muted-foreground hover:text-foreground"
            onClick={() => handleUpdate(columnSectionReset('Transform'))}
          >
            Reset transform
          </button>
          <SliderControl
            onCommit={commitPreview}
            onCancel={cancelPreview}
            restoreOnCommit={false}
            label="Rotation"
            max={180}
            min={-180}
            onChange={(value) => previewProp({ rotation: (value * Math.PI) / 180 })}
            precision={0}
            step={1}
            unit="°"
            value={Math.round((node.rotation * 180) / Math.PI)}
          />
        </PanelSection>

        <PanelSection title="Actions">
          <ActionGroup>
            {!managedByLeanTo && (
              <ActionButton icon={<Move className="h-4 w-4" />} label="Move" onClick={handleMove} />
            )}
            <ActionButton
              className="border-red-500/40 text-red-700 dark:text-red-200 hover:bg-red-500/15"
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete"
              onClick={handleDelete}
            />
          </ActionGroup>
        </PanelSection>
      </ColumnInspectorHover>
    </PanelWrapper>
  )
}
