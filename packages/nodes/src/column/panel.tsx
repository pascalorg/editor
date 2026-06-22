'use client'

import {
  type AnyNode,
  COLUMN_PRESETS,
  type ColumnNode,
  type ColumnPresetId,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  cn,
  PanelSection,
  PanelWrapper,
  SliderControl,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

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

function presetUpdates(presetId: ColumnPresetId): Partial<ColumnNode> {
  const { label, ...preset } = COLUMN_PRESETS[presetId]
  return {
    name: label,
    supportStyle: 'supportStyle' in preset ? preset.supportStyle : 'vertical',
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

export default function ColumnPanel() {
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
    triggerSFX('sfx:structure-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, selectedId, setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  if (!(node && node.type === 'column' && selectedId && selectedCount === 1)) return null
  const shaftProfile = node.shaftProfile ?? 'straight'
  const supportStyle = node.supportStyle ?? 'vertical'
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

  return (
    <PanelWrapper
      icon="/icons/column.webp"
      onClose={handleClose}
      title={node.name || 'Column'}
      width={300}
    >
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
        <div className="grid grid-cols-2 gap-2 px-1 pt-1">
          {SUPPORT_STYLE_OPTIONS.map((option) => {
            const isSelected = supportStyle === option.value
            return (
              <button
                className={cn(
                  'flex min-h-12 items-center rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                  isSelected
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
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
        {isBraceSupport ? (
          <>
            <SliderControl
              label="Brace Width"
              max={0.8}
              min={0.04}
              onChange={(value) => handleUpdate({ braceWidth: value, width: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.braceWidth ?? node.width}
            />
            <SliderControl
              label="Brace Depth"
              max={0.8}
              min={0.04}
              onChange={(value) => handleUpdate({ braceDepth: value, depth: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.braceDepth ?? node.depth}
            />
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 px-1 pt-1">
              {(
                [
                  {
                    value: 'round',
                    label: 'Round',
                    icon: (
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="22"
                        viewBox="0 0 22 22"
                        width="22"
                      >
                        <circle cx="11" cy="11" r="7.5" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    ),
                  },
                  {
                    value: 'square',
                    label: 'Square',
                    icon: (
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="22"
                        viewBox="0 0 22 22"
                        width="22"
                      >
                        <rect
                          height="15"
                          rx="1.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          width="15"
                          x="3.5"
                          y="3.5"
                        />
                      </svg>
                    ),
                  },
                  {
                    value: 'rectangular',
                    label: 'Rectangular',
                    icon: (
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="22"
                        viewBox="0 0 22 22"
                        width="22"
                      >
                        <rect
                          height="11"
                          rx="1.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          width="16"
                          x="3"
                          y="5.5"
                        />
                      </svg>
                    ),
                  },
                ] as {
                  value: ColumnNode['crossSection']
                  label: string
                  icon: React.ReactNode
                }[]
              ).map((option) => {
                const isSelected = node.crossSection === option.value
                return (
                  <button
                    className={cn(
                      'group flex flex-col items-center justify-center gap-1.5 rounded-lg border py-2.5 transition-all',
                      isSelected
                        ? 'border-orange-400/60 bg-orange-400/10 text-foreground shadow-[0_0_0_1px_rgba(251,146,60,0.25)_inset]'
                        : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:border-border hover:bg-[#3e3e3e] hover:text-foreground',
                    )}
                    key={option.value}
                    onClick={() => handleUpdate({ crossSection: option.value })}
                    type="button"
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center',
                        isSelected ? 'text-orange-300' : 'text-muted-foreground/80',
                      )}
                    >
                      {option.icon}
                    </span>
                    <span className="font-medium text-[11px] leading-none tracking-wide">
                      {option.label}
                    </span>
                  </button>
                )
              })}
            </div>
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
          </>
        )}
      </PanelSection>

      <PanelSection title="Dimensions">
        {!isBraceSupport && (
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
        )}
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
                label="Bottom Spread"
                max={4}
                min={0.2}
                onChange={(value) =>
                  handleUpdate({
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
            <SliderControl
              label={supportStyle === 'y-frame' ? 'Fork Spread' : 'Top Spread'}
              max={
                supportStyle === 'y-frame' ||
                supportStyle === 'v-frame' ||
                supportStyle === 'x-brace' ||
                supportStyle === 'k-brace' ||
                supportStyle === 'single-strut' ||
                supportStyle === 'tripod' ||
                supportStyle === 'trestle' ||
                supportStyle === 'box-frame'
                  ? 4
                  : Math.max(0.2, node.braceBottomSpread ?? 1.2)
              }
              min={0}
              onChange={(value) => handleUpdate({ braceTopSpread: value })}
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
                supportStyle === 'portal-frame' ||
                supportStyle === 'box-frame'
                  ? 1
                  : 0.12)
              }
            />
            <ToggleControl
              checked={node.bracePlateEnabled ?? true}
              label="Connector Plates"
              onChange={(checked) => handleUpdate({ bracePlateEnabled: checked })}
            />
          </>
        ) : (
          <>
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
          </>
        )}
      </PanelSection>

      {!isBraceSupport && (
        <PanelSection title="Shaft">
          <select
            className={SELECT_CLASS}
            onChange={(event) =>
              handleUpdate(shaftProfileUpdates(event.target.value as ColumnNode['shaftProfile']))
            }
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
      )}

      {!isBraceSupport && (
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
      )}

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
