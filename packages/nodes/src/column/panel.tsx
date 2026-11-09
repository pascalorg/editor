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
  type MessageDescriptor,
  scriptImages,
  useLiveNodeOverrides,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  armMaterialPaint,
  PanelSection as BasePanelSection,
  SliderControl as BaseSliderControl,
  PanelWrapper,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Move, PaintBucket, Trash2 } from 'lucide-react'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'

import { AuthoredParams } from '../item/authored-params'
import { isManagedColumn } from './edit-policy'
import { planColumnEdit } from './hosted-resize'
import { ColumnInspectorHover } from './inspector-highlight'
import { FramingPostSection } from './post-section'
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

/** Display names for the column's style, section, profile, detail and part values. */
const COLUMN_OPTION_LABELS: Record<string, MessageDescriptor> = {
  plain: /* i18n */ { id: 'node.column.panel.plain', message: 'Plain' },
  faceted: /* i18n */ { id: 'node.column.panel.faceted', message: 'Faceted' },
  fluted: /* i18n */ { id: 'node.column.panel.fluted', message: 'Fluted' },
  'lathe-turned': /* i18n */ { id: 'node.column.panel.latheTurned', message: 'Lathe Turned' },
  'dravidian-carved': /* i18n */ {
    id: 'node.column.panel.dravidianCarved',
    message: 'Dravidian Carved',
  },
  cluster: /* i18n */ { id: 'node.column.panel.cluster', message: 'Cluster' },
  round: /* i18n */ { id: 'node.column.panel.round', message: 'Round' },
  square: /* i18n */ { id: 'node.column.panel.square', message: 'Square' },
  rectangular: /* i18n */ { id: 'node.column.panel.rectangular', message: 'Rectangular' },
  octagonal: /* i18n */ { id: 'node.column.panel.octagonal', message: 'Octagonal' },
  'sixteen-sided': /* i18n */ { id: 'node.column.panel.sixteenSided', message: 'Sixteen Sided' },
  straight: /* i18n */ { id: 'node.column.panel.straight', message: 'Straight' },
  tapered: /* i18n */ { id: 'node.column.panel.tapered', message: 'Tapered' },
  bulged: /* i18n */ { id: 'node.column.panel.bulged', message: 'Bulged' },
  baluster: /* i18n */ { id: 'node.column.panel.baluster', message: 'Baluster' },
  hourglass: /* i18n */ { id: 'node.column.panel.hourglass', message: 'Hourglass' },
  none: /* i18n */ { id: 'node.column.panel.none', message: 'None' },
  spiral: /* i18n */ { id: 'node.column.panel.spiral', message: 'Spiral' },
  panelled: /* i18n */ { id: 'node.column.panel.panelled', message: 'Panelled' },
  rectangle: /* i18n */ { id: 'node.column.panel.rectangle', message: 'Rectangle' },
  arched: /* i18n */ { id: 'node.column.panel.arched', message: 'Arched' },
  diamond: /* i18n */ { id: 'node.column.panel.diamond', message: 'Diamond' },
  'simple-square': /* i18n */ { id: 'node.column.panel.simpleSquare', message: 'Simple Square' },
  'round-rings': /* i18n */ { id: 'node.column.panel.roundRings', message: 'Round Rings' },
  'square-plinth': /* i18n */ { id: 'node.column.panel.squarePlinth', message: 'Square Plinth' },
  'stepped-square': /* i18n */ { id: 'node.column.panel.steppedSquare', message: 'Stepped Square' },
  lotus: /* i18n */ { id: 'node.column.panel.lotus', message: 'Lotus' },
  'ribbed-lotus': /* i18n */ { id: 'node.column.panel.ribbedLotus', message: 'Ribbed Lotus' },
  'panelled-pedestal': /* i18n */ {
    id: 'node.column.panel.panelledPedestal',
    message: 'Panelled Pedestal',
  },
  simple: /* i18n */ { id: 'node.column.panel.simple', message: 'Simple' },
  'simple-slab': /* i18n */ { id: 'node.column.panel.simpleSlab', message: 'Simple Slab' },
  rounded: /* i18n */ { id: 'node.column.panel.rounded', message: 'Rounded' },
  stepped: /* i18n */ { id: 'node.column.panel.stepped', message: 'Stepped' },
  doric: /* i18n */ { id: 'node.column.panel.doric', message: 'Doric' },
  volute: /* i18n */ { id: 'node.column.panel.volute', message: 'Volute' },
  'ionic-volute': /* i18n */ { id: 'node.column.panel.ionicVolute', message: 'Ionic Volute' },
  'leaf-carved': /* i18n */ { id: 'node.column.panel.leafCarved', message: 'Leaf Carved' },
  'corinthian-leaf': /* i18n */ {
    id: 'node.column.panel.corinthianLeaf',
    message: 'Corinthian Leaf',
  },
  'south-indian-bracket': /* i18n */ {
    id: 'node.column.panel.southIndianBracket',
    message: 'South Indian Bracket',
  },
  'wood-bracket': /* i18n */ { id: 'node.column.panel.woodBracket', message: 'Wood Bracket' },
  shaft: /* i18n */ { id: 'node.column.panel.shaft', message: 'Shaft' },
  base: /* i18n */ { id: 'node.column.panel.base', message: 'Base' },
  capital: /* i18n */ { id: 'node.column.panel.capital', message: 'Capital' },
  all: /* i18n */ { id: 'node.column.panel.all', message: 'All' },
  frame: /* i18n */ { id: 'node.column.panel.frame', message: 'Frame' },
}
const detailFields = [
  [
    'fluteCount',
    /* i18n */ { id: 'node.column.panel.fluteCount', message: 'Flute Count' },
    0,
    32,
    1,
  ],
  [
    'fluteDepth',
    /* i18n */ { id: 'node.column.panel.fluteDepth', message: 'Flute Depth' },
    0.005,
    0.08,
    0.005,
  ],
  [
    'fluteWidth',
    /* i18n */ { id: 'node.column.panel.fluteWidth', message: 'Flute Width' },
    0.005,
    0.1,
    0.005,
  ],
  [
    'spiralRibCount',
    /* i18n */ { id: 'node.column.panel.spiralRibCount', message: 'Spiral Ribs' },
    0,
    32,
    1,
  ],
  [
    'spiralTwist',
    /* i18n */ { id: 'node.column.panel.spiralTwist', message: 'Spiral Turns' },
    -3,
    3,
    0.1,
  ],
  [
    'panelCount',
    /* i18n */ { id: 'node.column.panel.panelCount', message: 'Carved Panels' },
    0,
    24,
    1,
  ],
  [
    'panelInsetDepth',
    /* i18n */ { id: 'node.column.panel.panelInsetDepth', message: 'Panel Relief' },
    0,
    0.1,
    0.005,
  ],
  [
    'latheRingCount',
    /* i18n */ { id: 'node.column.panel.latheRingCount', message: 'Lathe Rings' },
    0,
    32,
    1,
  ],
  ['voluteCount', /* i18n */ { id: 'node.column.panel.voluteCount', message: 'Volutes' }, 0, 8, 1],
  [
    'voluteSize',
    /* i18n */ { id: 'node.column.panel.voluteSize', message: 'Volute Size' },
    0.02,
    0.3,
    0.01,
  ],
  ['leafCount', /* i18n */ { id: 'node.column.panel.leafCount', message: 'Leaves' }, 0, 48, 1],
  ['leafRows', /* i18n */ { id: 'node.column.panel.leafRows', message: 'Leaf Rows' }, 0, 4, 1],
  [
    'bracketDepth',
    /* i18n */ { id: 'node.column.panel.bracketDepth', message: 'Bracket Depth' },
    0,
    1.5,
    0.01,
  ],
  [
    'bracketTierCount',
    /* i18n */ { id: 'node.column.panel.bracketTierCount', message: 'Bracket Tiers' },
    0,
    8,
    1,
  ],
  [
    'pendantCount',
    /* i18n */ { id: 'node.column.panel.pendantCount', message: 'Pendants' },
    0,
    16,
    1,
  ],
  [
    'baseRibCount',
    /* i18n */ { id: 'node.column.panel.baseRibCount', message: 'Base Ribs' },
    0,
    48,
    1,
  ],
  [
    'baseCarvingLevel',
    /* i18n */ { id: 'node.column.panel.baseCarvingLevel', message: 'Base Carving' },
    0,
    4,
    1,
  ],
  [
    'capitalCarvingLevel',
    /* i18n */ { id: 'node.column.panel.capitalCarvingLevel', message: 'Capital Carving' },
    0,
    4,
    1,
  ],
] as const

const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-sm text-foreground outline-none transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e] focus:ring-1 focus:ring-border'

const COLUMN_PROPORTION_PRESETS = {
  slender: {
    label: /* i18n */ { id: 'node.column.panel.slender', message: 'Slender' },
    height: 3.6,
    width: 0.34,
    baseHeight: 0.18,
    capitalHeight: 0.16,
    baseWidthScale: 1.18,
    capitalWidthScale: 1.16,
    edgeSoftness: 0.02,
  },
  standard: {
    label: /* i18n */ { id: 'node.column.panel.standard', message: 'Standard' },
    height: 2.9,
    width: 0.44,
    baseHeight: 0.22,
    capitalHeight: 0.2,
    baseWidthScale: 1.24,
    capitalWidthScale: 1.22,
    edgeSoftness: 0.025,
  },
  heavy: {
    label: /* i18n */ { id: 'node.column.panel.heavy', message: 'Heavy' },
    height: 3,
    width: 0.58,
    baseHeight: 0.28,
    capitalHeight: 0.26,
    baseWidthScale: 1.34,
    capitalWidthScale: 1.3,
    edgeSoftness: 0.035,
  },
  stout: {
    label: /* i18n */ { id: 'node.column.panel.shortStout', message: 'Short / Stout' },
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
  const i18n = usePascalI18n()
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
  const [previewingPreset, setPreviewingPreset] = useState(false)
  const node =
    storedNode && overrides && !previewingPreset
      ? ({ ...storedNode, ...overrides } as ColumnNode)
      : storedNode
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
  const previewPreset = useCallback(
    (updates: Partial<ColumnNode>) => {
      // Presets preview the scene, while controls keep the committed shape's layout.
      setPreviewingPreset(true)
      preview?.preview(updates)
    },
    [preview],
  )
  const cancelPresetPreview = useCallback(() => {
    preview?.cancel()
    setPreviewingPreset(false)
  }, [preview])
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
        label={i18n._(label)}
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
      title={node.name || i18n._({ id: 'node.column.panel.column', message: 'Column' })}
      width={300}
    >
      <ColumnInspectorHover nodeId={selectedId as AnyNodeId}>
        {/* A framing post is a sawn post, not a styled column: its own short section. */}
        {node.role === 'post' ? (
          <FramingPostSection node={node} onUpdate={handleUpdate} />
        ) : node.source ? (
          <div data-column-part="all">
            <AuthoredParams node={node} />
          </div>
        ) : (
          <>
            <PanelSection
              part="all"
              title={i18n._({ id: 'node.column.panel.shape', message: 'Shape' })}
            >
              <button
                type="button"
                className="self-end text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleUpdate(columnSectionReset('Shape'))}
              >
                {i18n._({ id: 'node.column.panel.resetShape', message: 'Reset shape' })}
              </button>
              <ColumnPresetGallery
                node={node}
                onPreview={previewPreset}
                onCancel={cancelPresetPreview}
                onApply={handleUpdate}
              />
              {!isBraceSupport && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {i18n._({ id: 'node.column.panel.style', message: 'Style' })}
                  </p>
                  <select
                    aria-label={i18n._({
                      id: 'node.column.panel.columnStyle',
                      message: 'Column style',
                    })}
                    className={SELECT_CLASS}
                    value={node.style}
                    onChange={(event) =>
                      handleUpdate({ style: ColumnStyle.parse(event.target.value) })
                    }
                  >
                    {ColumnStyle.options.map((value) => (
                      <option key={value} value={value}>
                        {i18n._(COLUMN_OPTION_LABELS[value]!)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {i18n._({ id: 'node.column.panel.crossSection', message: 'Cross section' })}
                  </p>
                  <select
                    aria-label={i18n._({
                      id: 'node.column.panel.crossSection',
                      message: 'Cross section',
                    })}
                    className={SELECT_CLASS}
                    value={node.crossSection}
                    onChange={(event) =>
                      handleUpdate({ crossSection: ColumnCrossSection.parse(event.target.value) })
                    }
                  >
                    {ColumnCrossSection.options.map((value) => (
                      <option key={value} value={value}>
                        {i18n._(COLUMN_OPTION_LABELS[value]!)}
                      </option>
                    ))}
                  </select>
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label={i18n._({
                      id: 'node.column.panel.edgeSoftness',
                      message: 'Edge Softness',
                    })}
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
                      label={i18n._({
                        id: 'node.column.panel.shaftCornerRadius',
                        message: 'Shaft Corner Radius',
                      })}
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

            <PanelSection
              part="all"
              title={i18n._({ id: 'node.column.panel.size', message: 'Size' })}
            >
              <button
                type="button"
                className="self-end text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleUpdate(columnSectionReset('Size'))}
              >
                {i18n._({ id: 'node.column.panel.resetSize', message: 'Reset size' })}
              </button>
              {isBraceSupport && (
                <>
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label={i18n._({ id: 'node.column.panel.memberWidth', message: 'Member Width' })}
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
                    label={i18n._({ id: 'node.column.panel.memberDepth', message: 'Member Depth' })}
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
                  {i18n._({
                    id: 'node.column.panel.heightAndFootprintAreControlledBy',
                    message:
                      'Height and footprint are controlled by the lean-to extension. Rotate or change the support style here; resize from the parent lean-to.',
                  })}
                </p>
              )}
              {!isBraceSupport && !managedByLeanTo && (
                <select
                  aria-label={i18n._({
                    id: 'node.column.panel.columnProportions',
                    message: 'Column proportions',
                  })}
                  className={SELECT_CLASS}
                  onChange={(event) => {
                    if (!event.target.value) return
                    handleUpdate(
                      proportionUpdates(node, event.target.value as ColumnProportionPresetId),
                    )
                  }}
                  value=""
                >
                  <option value="">
                    {i18n._({
                      id: 'node.column.panel.applyProportion',
                      message: 'Apply proportion...',
                    })}
                  </option>
                  {COLUMN_PROPORTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {i18n._(option.label)}
                    </option>
                  ))}
                </select>
              )}
              {!managedByLeanTo && (
                <SliderControl
                  onCommit={commitPreview}
                  onCancel={cancelPreview}
                  restoreOnCommit={false}
                  label={i18n._({ id: 'node.column.panel.height', message: 'Height' })}
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
                          ? i18n._({ id: 'node.column.panel.widthSpan', message: 'Width Span' })
                          : i18n._({
                              id: 'node.column.panel.bottomSpread',
                              message: 'Bottom Spread',
                            })
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
                          ? i18n._({ id: 'node.column.panel.depthSpan', message: 'Depth Span' })
                          : supportStyle === 'y-frame' || supportStyle === 'v-frame'
                            ? i18n._({ id: 'node.column.panel.forkSpread', message: 'Fork Spread' })
                            : i18n._({ id: 'node.column.panel.topSpread', message: 'Top Spread' })
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
                    label={i18n._({
                      id: 'node.column.panel.connectorPlates',
                      message: 'Connector Plates',
                    })}
                    onChange={(checked) => handleUpdate({ bracePlateEnabled: checked })}
                  />
                </>
              ) : !managedByLeanTo ? (
                <>
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label={
                      radialSection
                        ? i18n._({ id: 'node.column.panel.diameter', message: 'Diameter' })
                        : i18n._({ id: 'node.column.panel.width', message: 'Width' })
                    }
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
                      label={i18n._({ id: 'node.column.panel.depth', message: 'Depth' })}
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
              <PanelSection
                part="shaft"
                title={i18n._({ id: 'node.column.panel.profile', message: 'Profile' })}
              >
                <button
                  type="button"
                  className="self-end text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleUpdate(columnSectionReset('Profile'))}
                >
                  {i18n._({ id: 'node.column.panel.resetProfile', message: 'Reset profile' })}
                </button>
                <p className="text-xs text-muted-foreground">
                  {i18n._({
                    id: 'node.column.panel.scalesMultiplyTheDimensionsInSize',
                    message: 'Scales multiply the dimensions in Size. A ratio of 0.2 means 20%.',
                  })}
                </p>
                <select
                  aria-label={i18n._({
                    id: 'node.column.panel.shaftProfile',
                    message: 'Shaft profile',
                  })}
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
                      {i18n._(COLUMN_OPTION_LABELS[value]!)}
                    </option>
                  ))}
                </select>
                {shaftProfile === 'straight' && (
                  <SliderControl
                    onCommit={commitPreview}
                    onCancel={cancelPreview}
                    restoreOnCommit={false}
                    label={i18n._({ id: 'node.column.panel.shaftScale', message: 'Shaft Scale' })}
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
                      label={i18n._({
                        id: 'node.column.panel.bottomScale',
                        message: 'Bottom Scale',
                      })}
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
                      label={i18n._({ id: 'node.column.panel.topScale', message: 'Top Scale' })}
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
                      label={i18n._({ id: 'node.column.panel.taperRatio', message: 'Taper Ratio' })}
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
                      label={i18n._({ id: 'node.column.panel.endScale', message: 'End Scale' })}
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
                      label={i18n._({ id: 'node.column.panel.bulgeRatio', message: 'Bulge Ratio' })}
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
                      label={i18n._({ id: 'node.column.panel.endScale', message: 'End Scale' })}
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
                      label={i18n._({
                        id: 'node.column.panel.waistReductionRatio',
                        message: 'Waist Reduction Ratio',
                      })}
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
                  label={i18n._({
                    id: 'node.column.panel.twistPerSegment',
                    message: 'Twist per Segment',
                  })}
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
                    label={i18n._({
                      id: 'node.column.panel.twistSegments',
                      message: 'Twist Segments',
                    })}
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
                <PanelSection
                  part="base"
                  title={i18n._({ id: 'node.column.panel.base', message: 'Base' })}
                >
                  <button
                    type="button"
                    className="self-end text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleUpdate(columnSectionReset('Base'))}
                  >
                    {i18n._({ id: 'node.column.panel.resetBase', message: 'Reset base' })}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {i18n._({
                      id: 'node.column.panel.widthAndDepthScalesUseSize',
                      message:
                        'Width and depth scales use Size. Band and neck scales use the base footprint.',
                    })}
                  </p>
                  <select
                    aria-label={i18n._({
                      id: 'node.column.panel.baseStyle',
                      message: 'Base style',
                    })}
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
                        {i18n._(COLUMN_OPTION_LABELS[value]!)}
                      </option>
                    ))}
                  </select>
                  {node.baseStyle !== 'none' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label={i18n._({ id: 'node.column.panel.baseHeight', message: 'Base Height' })}
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
                      label={i18n._({ id: 'node.column.panel.widthScale', message: 'Width Scale' })}
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
                      label={i18n._({ id: 'node.column.panel.depthScale', message: 'Depth Scale' })}
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
                      label={i18n._({
                        id: 'node.column.panel.plinthHeightFraction',
                        message: 'Plinth Height Fraction',
                      })}
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
                      label={i18n._({ id: 'node.column.panel.bandScale', message: 'Band Scale' })}
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
                      label={i18n._({ id: 'node.column.panel.neckScale', message: 'Neck Scale' })}
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
                      label={i18n._({ id: 'node.column.panel.tierCount', message: 'Tier Count' })}
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
                      label={i18n._({
                        id: 'node.column.panel.stepScaleReduction',
                        message: 'Step Scale Reduction',
                      })}
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
                <PanelSection
                  part="capital"
                  title={i18n._({ id: 'node.column.panel.capital', message: 'Capital' })}
                >
                  <button
                    type="button"
                    className="self-end text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleUpdate(columnSectionReset('Capital'))}
                  >
                    {i18n._({ id: 'node.column.panel.resetCapital', message: 'Reset capital' })}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {i18n._({
                      id: 'node.column.panel.widthAndDepthScalesMultiplyThe',
                      message: 'Width and depth scales multiply the dimensions in Size.',
                    })}
                  </p>
                  <select
                    aria-label={i18n._({
                      id: 'node.column.panel.capitalStyle',
                      message: 'Capital style',
                    })}
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
                        {i18n._(COLUMN_OPTION_LABELS[value]!)}
                      </option>
                    ))}
                  </select>
                  {node.capitalStyle !== 'none' && (
                    <SliderControl
                      onCommit={commitPreview}
                      onCancel={cancelPreview}
                      restoreOnCommit={false}
                      label={i18n._({
                        id: 'node.column.panel.capitalHeight',
                        message: 'Capital Height',
                      })}
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
                      label={i18n._({ id: 'node.column.panel.widthScale', message: 'Width Scale' })}
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
                      label={i18n._({ id: 'node.column.panel.depthScale', message: 'Depth Scale' })}
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
                      label={i18n._({ id: 'node.column.panel.tierCount', message: 'Tier Count' })}
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
                      label={i18n._({
                        id: 'node.column.panel.stepScaleReduction',
                        message: 'Step Scale Reduction',
                      })}
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
              <PanelSection
                part="shaft"
                title={i18n._({
                  id: 'node.column.panel.surfaceDetails',
                  message: 'Surface Details',
                })}
              >
                <button
                  type="button"
                  className="self-end text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleUpdate(columnSectionReset('Surface Details'))}
                >
                  {i18n._({
                    id: 'node.column.panel.resetSurfaceDetails',
                    message: 'Reset surface details',
                  })}
                </button>
                <p className="text-xs text-muted-foreground">
                  {i18n._({ id: 'node.column.panel.shaftDetail', message: 'Shaft detail' })}
                </p>
                <select
                  aria-label={i18n._({
                    id: 'node.column.panel.shaftDetail',
                    message: 'Shaft detail',
                  })}
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
                      {i18n._(COLUMN_OPTION_LABELS[value]!)}
                    </option>
                  ))}
                </select>
                {hasPanels && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {i18n._({ id: 'node.column.panel.panelShape', message: 'Panel shape' })}
                    </p>
                    <select
                      aria-label={i18n._({
                        id: 'node.column.panel.panelShape',
                        message: 'Panel shape',
                      })}
                      className={SELECT_CLASS}
                      value={node.panelShape}
                      onChange={(event) =>
                        handleUpdate({ panelShape: ColumnPanelShape.parse(event.target.value) })
                      }
                    >
                      {ColumnPanelShape.options.map((value) => (
                        <option key={value} value={value}>
                          {i18n._(COLUMN_OPTION_LABELS[value]!)}
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
                  label={i18n._({ id: 'node.column.panel.ringPairs', message: 'Ring Pairs' })}
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
                    label={i18n._({
                      id: 'node.column.panel.ringThickness',
                      message: 'Ring Thickness',
                    })}
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
                    label={i18n._({
                      id: 'node.column.panel.ringSpreadRatio',
                      message: 'Ring Spread Ratio',
                    })}
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
                    <p className="text-xs text-muted-foreground">
                      {i18n._({
                        id: 'node.column.panel.carvingPlacement',
                        message: 'Carving placement',
                      })}
                    </p>
                    <select
                      aria-label={i18n._({
                        id: 'node.column.panel.carvingPlacement',
                        message: 'Carving placement',
                      })}
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
                          {i18n._(COLUMN_OPTION_LABELS[value]!)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </PanelSection>
            )}
          </>
        )}
        <PanelSection
          title={i18n._({ id: 'node.column.panel.materials', message: 'Materials' })}
          defaultExpanded={false}
        >
          <button
            type="button"
            className="self-end text-xs text-muted-foreground hover:text-foreground"
            onClick={() => handleUpdate(columnSectionReset('Materials'))}
          >
            {i18n._({ id: 'node.column.panel.resetMaterials', message: 'Reset materials' })}
          </button>
          <p className="text-xs text-muted-foreground">
            {i18n._({
              id: 'node.column.panel.chooseAMaterialThenClickThe',
              message: 'Choose a material, then click the surface to paint.',
            })}
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
                {part === 'all'
                  ? i18n._({ id: 'node.column.panel.entireObject', message: 'Entire Object' })
                  : i18n._(COLUMN_OPTION_LABELS[part]!)}
              </button>
            ))}
          </div>
          <ActionButton
            icon={<PaintBucket className="h-4 w-4" />}
            label={i18n._({ id: 'node.column.panel.paintMaterials', message: 'Paint Materials' })}
            onClick={() => {
              cancelPreview()
              armMaterialPaint(undefined, 'surface')
            }}
          />
        </PanelSection>
        <PanelSection
          part="all"
          title={i18n._({ id: 'node.column.panel.transform', message: 'Transform' })}
        >
          <button
            type="button"
            className="self-end text-xs text-muted-foreground hover:text-foreground"
            onClick={() => handleUpdate(columnSectionReset('Transform'))}
          >
            {i18n._({ id: 'node.column.panel.resetTransform', message: 'Reset transform' })}
          </button>
          <SliderControl
            onCommit={commitPreview}
            onCancel={cancelPreview}
            restoreOnCommit={false}
            label={i18n._({ id: 'node.column.panel.rotation', message: 'Rotation' })}
            max={180}
            min={-180}
            onChange={(value) => previewProp({ rotation: (value * Math.PI) / 180 })}
            precision={0}
            step={1}
            unit="°"
            value={Math.round((node.rotation * 180) / Math.PI)}
          />
        </PanelSection>

        <PanelSection title={i18n._({ id: 'node.column.panel.actions', message: 'Actions' })}>
          <ActionGroup>
            {!managedByLeanTo && (
              <ActionButton
                icon={<Move className="h-4 w-4" />}
                label={i18n._({ id: 'node.column.panel.move', message: 'Move' })}
                onClick={handleMove}
              />
            )}
            <ActionButton
              className="border-red-500/40 text-red-700 dark:text-red-200 hover:bg-red-500/15"
              icon={<Trash2 className="h-4 w-4" />}
              label={i18n._({ id: 'node.column.panel.delete', message: 'Delete' })}
              onClick={handleDelete}
            />
          </ActionGroup>
        </PanelSection>
      </ColumnInspectorHover>
    </PanelWrapper>
  )
}
