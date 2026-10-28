'use client'

import {
  getRailingWallConfig,
  getRailingWallHeight,
  RAILING_GUARD_HEIGHT,
  RAILING_GUARD_HEIGHT_TALL,
  RAILING_SPHERE_LIMIT,
  type RailingWallConfig,
  type WallNode,
} from '@pascal-app/core'
import {
  PanelSection,
  SegmentedControl,
  SelectControl,
  SliderControl,
  ToggleControl,
} from '@pascal-app/editor'
import {
  getRailingWallUpdate,
  RAILING_CAPPED_STYLES,
  RAILING_INFILL_LABELS,
  RAILING_STYLE_OPTIONS,
  railingHeightPreset,
  railingStylePatch,
} from './railing-wall-panel-model'

const INCH = 0.0254
/** The panel's lengths stop here: a guard is never this big, so the cap only bounds the slider. */
const MAX_LENGTH = 1000

type Props = {
  node: WallNode
  unit: 'metric' | 'imperial'
  onUpdate: (patch: Partial<WallNode>) => void
  onPreview: (patch: Partial<WallNode>) => void
  onCommit: () => void
  onCancel: () => void
}

/**
 * The wall panel's railing controls: the style, the guard's height
 * (36 in, 42 in or its own), the posts' spacing and size, and the infill. Lengths read in inches
 * on an imperial plan, where feet would show a 1½ in baluster as 0.13.
 */
export function RailingWallPanel({ node, unit, onUpdate, onPreview, onCommit, onCancel }: Props) {
  const config = getRailingWallConfig(node)
  const height = getRailingWallHeight(node)
  const imperial = unit === 'imperial'
  const toShown = (meters: number) => (imperial ? meters / INCH : meters)
  const toMeters = (shown: number) => (imperial ? shown * INCH : shown)
  const update = (patch: Partial<RailingWallConfig>, preview = false) =>
    (preview ? onPreview : onUpdate)(getRailingWallUpdate(node, patch))
  const length = (
    label: string,
    value: number,
    min: number,
    onChange: (meters: number) => void,
  ) => (
    <SliderControl
      label={label}
      max={toShown(MAX_LENGTH)}
      min={toShown(min)}
      onCancel={onCancel}
      onChange={(shown) => onChange(Math.min(Math.max(toMeters(shown), min), MAX_LENGTH))}
      onCommit={onCommit}
      precision={imperial ? 2 : 3}
      previewWhileTyping
      restoreOnCommit={false}
      step={imperial ? 0.25 : 0.005}
      unit={imperial ? 'in' : 'm'}
      value={toShown(value)}
    />
  )
  const preset = railingHeightPreset(height)
  const infill = RAILING_INFILL_LABELS[config.style]
  // IRC R312.1.3: no opening in a guard may pass a 4 in sphere.
  const opensPastSphere =
    (infill.gap !== null && config.infillGap >= RAILING_SPHERE_LIMIT) ||
    config.bottomClearance >= RAILING_SPHERE_LIMIT

  return (
    <>
      <PanelSection title="Railing">
        <SelectControl
          label="Style"
          onChange={(style) => update(railingStylePatch(style))}
          options={RAILING_STYLE_OPTIONS}
          value={config.style}
        />
        <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Height
        </div>
        <SegmentedControl
          mixed={preset === null}
          onChange={(next) =>
            onUpdate({ height: next === '42' ? RAILING_GUARD_HEIGHT_TALL : RAILING_GUARD_HEIGHT })
          }
          options={[
            { label: '36 in', value: '36' },
            { label: '42 in', value: '42' },
          ]}
          value={preset ?? '36'}
        />
        {length('Height', height, 0.1, (meters) => onPreview({ height: meters }))}
        {RAILING_CAPPED_STYLES.has(config.style) && (
          <ToggleControl checked={config.cap} label="2x6 cap" onChange={(cap) => update({ cap })} />
        )}
      </PanelSection>
      <PanelSection title="Posts">
        {length('Max spacing', config.postSpacing, 0.1, (postSpacing) =>
          update({ postSpacing }, true),
        )}
        {length('Post size', config.postSize, 0.01, (postSize) => update({ postSize }, true))}
      </PanelSection>
      <PanelSection title="Infill">
        {length(infill.size, config.infillSize, 0.003, (infillSize) =>
          update({ infillSize }, true),
        )}
        {infill.gap !== null &&
          length(infill.gap, config.infillGap, 0, (infillGap) => update({ infillGap }, true))}
        {length('Floor clearance', config.bottomClearance, 0, (bottomClearance) =>
          update({ bottomClearance }, true),
        )}
        {opensPastSphere && (
          <p className="px-1 text-[11px] text-muted-foreground">
            A guard's openings must not pass a 4 in sphere (IRC R312.1.3).
          </p>
        )}
      </PanelSection>
    </>
  )
}
