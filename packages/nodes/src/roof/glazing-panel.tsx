'use client'

import {
  type AnyNodeId,
  getEffectiveNode,
  getRoofGlazing,
  isGlazedRoofSegment,
  type RoofGlazing,
  type RoofSegmentNode,
  supportsRoofGlazing,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import { PanelSection, SegmentedControl, ToggleControl } from '@pascal-app/editor'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  GLAZING_INFILL_OPTIONS,
  GlazingColor,
  GlazingGridControls,
  GlazingNumber,
} from './glazing-controls'
import { GlazingPanelEditor } from './glazing-panel-editor'
import { createRoofGlazingPreview } from './glazing-preview'

export function RoofGlazingPanel({ segments }: { segments: readonly RoofSegmentNode[] }) {
  useLiveNodeOverrides(
    useShallow((state) => segments.map((segment) => state.overrides.get(segment.id))),
  )
  const idKey = segments.map((segment) => segment.id).join(',')
  const preview = useMemo(
    () => createRoofGlazingPreview(idKey ? (idKey.split(',') as AnyNodeId[]) : []),
    [idKey],
  )
  useEffect(() => () => preview.cancel(), [preview])
  if (!segments.length) return null
  const effectiveSegments = segments.map((segment) => getEffectiveNode(segment))
  const node = effectiveSegments[0]!
  const config = getRoofGlazing(node)
  const configs = effectiveSegments.map(getRoofGlazing)
  const glazed = isGlazedRoofSegment(node)
  const supported = effectiveSegments.every(supportsRoofGlazing)
  const mixed = effectiveSegments.some((segment) => isGlazedRoofSegment(segment) !== glazed)
  const allBarrel = effectiveSegments.every((segment) => segment.roofType === 'barrel')
  const mixedField = (field: keyof RoofGlazing) =>
    configs.some((value) => value[field] !== config[field])
  const update = (patch: Partial<RoofGlazing>) => {
    preview.previewGlazing((current) => ({ ...current, ...patch }))
    preview.commit()
  }
  return (
    <>
      <PanelSection title="Roof system">
        <SegmentedControl
          value={glazed ? 'glazed' : 'standard'}
          mixed={mixed}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'glazed', label: 'Glazed', disabled: !supported },
          ]}
          onChange={(roofSystem) => {
            if (roofSystem === 'standard' || supported) preview.commit({ roofSystem })
          }}
        />
        {!supported && (
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            Glazing is available for gable, straight shed, and barrel roofs.
          </p>
        )}
        {mixed && (
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            Choose one roof system to edit settings for all selected segments.
          </p>
        )}
        {segments.length > 1 && (
          <p className="pt-1 text-[11px] text-muted-foreground">
            Changes apply to all {segments.length} roof segments.
          </p>
        )}
      </PanelSection>
      {glazed && !mixed && (
        <>
          <GlazingGridControls
            axis="across"
            title={allBarrel ? 'Grid along the length' : 'Grid across the roof'}
            description={
              allBarrel
                ? 'Divides the length of each arch bay into columns.'
                : 'Divides each roof face into columns.'
            }
            grid={config.across}
            grids={configs.map((value) => value.across)}
            preview={preview}
          />
          <GlazingGridControls
            axis="along"
            title={allBarrel ? 'Grid within each arch bay' : 'Grid along the slope'}
            description={
              allBarrel
                ? 'Subdivides each flat arch bay. Arch bays controls the divisions around the curve.'
                : 'Spacing is measured on the slope, not its horizontal projection.'
            }
            grid={config.along}
            grids={configs.map((value) => value.along)}
            preview={preview}
          />
          <PanelSection title="Framing">
            <GlazingNumber
              field="frameWidth"
              label="Frame width"
              value={config.frameWidth}
              mixed={mixedField('frameWidth')}
              preview={preview}
            />
            <GlazingNumber
              field="frameDepth"
              label="Frame depth"
              value={config.frameDepth}
              mixed={mixedField('frameDepth')}
              preview={preview}
            />
            <GlazingColor
              field="frameColor"
              label="Frame color"
              value={config.frameColor}
              mixed={mixedField('frameColor')}
              preview={preview}
            />
          </PanelSection>
          <PanelSection title="Glass">
            <GlazingNumber
              field="glassThickness"
              label="Pane thickness"
              value={config.glassThickness}
              mixed={mixedField('glassThickness')}
              preview={preview}
            />
            <GlazingColor
              field="glassColor"
              label="Glass tint"
              value={config.glassColor}
              mixed={mixedField('glassColor')}
              preview={preview}
            />
            <GlazingNumber
              field="glassOpacity"
              label="Opacity"
              value={config.glassOpacity}
              mixed={mixedField('glassOpacity')}
              preview={preview}
              fraction
            />
            <GlazingNumber
              field="glassRoughness"
              label="Roughness"
              value={config.glassRoughness}
              mixed={mixedField('glassRoughness')}
              preview={preview}
              fraction
            />
          </PanelSection>
          <PanelSection title="Infill">
            <div
              className="flex flex-col gap-2 pb-1"
              role="group"
              aria-label="Default panel infill"
            >
              <span className="text-xs text-muted-foreground">Default panel infill</span>
              <SegmentedControl
                value={config.panelType}
                mixed={mixedField('panelType')}
                options={GLAZING_INFILL_OPTIONS}
                onChange={(panelType) => update({ panelType })}
              />
            </div>
            <ToggleControl
              label="Close the roof ends"
              checked={config.glazedEnds}
              mixed={mixedField('glazedEnds')}
              onChange={(glazedEnds) => update({ glazedEnds })}
            />
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              End infill fills the space above the walls. Edit room walls and ceilings separately.
            </p>
          </PanelSection>
          {segments.length === 1 && (
            <GlazingPanelEditor key={node.id} node={node} onUpdate={update} />
          )}
        </>
      )}
    </>
  )
}
