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
  usePascalI18n,
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
  const i18n = usePascalI18n()
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
      <PanelSection
        title={i18n._({ id: 'node.roof.glazingPanel.roofSystem', message: 'Roof system' })}
      >
        <SegmentedControl
          value={glazed ? 'glazed' : 'standard'}
          mixed={mixed}
          options={[
            {
              value: 'standard',
              label: i18n._({ id: 'node.roof.glazingPanel.standard', message: 'Standard' }),
            },
            {
              value: 'glazed',
              label: i18n._({ id: 'node.roof.glazingPanel.glazed', message: 'Glazed' }),
              disabled: !supported,
            },
          ]}
          onChange={(roofSystem) => {
            if (roofSystem === 'standard' || supported) preview.commit({ roofSystem })
          }}
        />
        {!supported && (
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            {i18n._({
              id: 'node.roof.glazingPanel.glazingIsAvailableForGableStraight',
              message: 'Glazing is available for gable, straight shed, and barrel roofs.',
            })}
          </p>
        )}
        {mixed && (
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            {i18n._({
              id: 'node.roof.glazingPanel.chooseOneRoofSystemToEdit',
              message: 'Choose one roof system to edit settings for all selected segments.',
            })}
          </p>
        )}
        {segments.length > 1 && (
          <p className="pt-1 text-[11px] text-muted-foreground">
            {i18n._({
              id: 'node.roof.glazingPanel.changesApplyToAllLengthRoof',
              message: 'Changes apply to all {length} roof segments.',
              values: { length: segments.length },
            })}
          </p>
        )}
      </PanelSection>
      {glazed && !mixed && (
        <>
          <GlazingGridControls
            axis="across"
            title={
              allBarrel
                ? i18n._({
                    id: 'node.roof.glazingPanel.gridAlongTheLength',
                    message: 'Grid along the length',
                  })
                : i18n._({
                    id: 'node.roof.glazingPanel.gridAcrossTheRoof',
                    message: 'Grid across the roof',
                  })
            }
            description={
              allBarrel
                ? i18n._({
                    id: 'node.roof.glazingPanel.dividesTheLengthOfEachArch',
                    message: 'Divides the length of each arch bay into columns.',
                  })
                : i18n._({
                    id: 'node.roof.glazingPanel.dividesEachRoofFaceIntoColumns',
                    message: 'Divides each roof face into columns.',
                  })
            }
            grid={config.across}
            grids={configs.map((value) => value.across)}
            preview={preview}
          />
          <GlazingGridControls
            axis="along"
            title={
              allBarrel
                ? i18n._({
                    id: 'node.roof.glazingPanel.gridWithinEachArchBay',
                    message: 'Grid within each arch bay',
                  })
                : i18n._({
                    id: 'node.roof.glazingPanel.gridAlongTheSlope',
                    message: 'Grid along the slope',
                  })
            }
            description={
              allBarrel
                ? i18n._({
                    id: 'node.roof.glazingPanel.subdividesEachFlatArchBayArch',
                    message:
                      'Subdivides each flat arch bay. Arch bays controls the divisions around the curve.',
                  })
                : i18n._({
                    id: 'node.roof.glazingPanel.spacingIsMeasuredOnTheSlope',
                    message: 'Spacing is measured on the slope, not its horizontal projection.',
                  })
            }
            grid={config.along}
            grids={configs.map((value) => value.along)}
            preview={preview}
          />
          <PanelSection
            title={i18n._({ id: 'node.roof.glazingPanel.framing', message: 'Framing' })}
          >
            <GlazingNumber
              field="frameWidth"
              label={i18n._({ id: 'node.roof.glazingPanel.frameWidth', message: 'Frame width' })}
              value={config.frameWidth}
              mixed={mixedField('frameWidth')}
              preview={preview}
            />
            <GlazingNumber
              field="frameDepth"
              label={i18n._({ id: 'node.roof.glazingPanel.frameDepth', message: 'Frame depth' })}
              value={config.frameDepth}
              mixed={mixedField('frameDepth')}
              preview={preview}
            />
            <GlazingColor
              field="frameColor"
              label={i18n._({ id: 'node.roof.glazingPanel.frameColor', message: 'Frame color' })}
              value={config.frameColor}
              mixed={mixedField('frameColor')}
              preview={preview}
            />
          </PanelSection>
          <PanelSection title={i18n._({ id: 'node.roof.glazingPanel.glass', message: 'Glass' })}>
            <GlazingNumber
              field="glassThickness"
              label={i18n._({
                id: 'node.roof.glazingPanel.paneThickness',
                message: 'Pane thickness',
              })}
              value={config.glassThickness}
              mixed={mixedField('glassThickness')}
              preview={preview}
            />
            <GlazingColor
              field="glassColor"
              label={i18n._({ id: 'node.roof.glazingPanel.glassTint', message: 'Glass tint' })}
              value={config.glassColor}
              mixed={mixedField('glassColor')}
              preview={preview}
            />
            <GlazingNumber
              field="glassOpacity"
              label={i18n._({ id: 'node.roof.glazingPanel.opacity', message: 'Opacity' })}
              value={config.glassOpacity}
              mixed={mixedField('glassOpacity')}
              preview={preview}
              fraction
            />
            <GlazingNumber
              field="glassRoughness"
              label={i18n._({ id: 'node.roof.glazingPanel.roughness', message: 'Roughness' })}
              value={config.glassRoughness}
              mixed={mixedField('glassRoughness')}
              preview={preview}
              fraction
            />
          </PanelSection>
          <PanelSection title={i18n._({ id: 'node.roof.glazingPanel.infill', message: 'Infill' })}>
            <div
              className="flex flex-col gap-2 pb-1"
              role="group"
              aria-label={i18n._({
                id: 'node.roof.glazingPanel.defaultPanelInfill',
                message: 'Default panel infill',
              })}
            >
              <span className="text-xs text-muted-foreground">
                {i18n._({
                  id: 'node.roof.glazingPanel.defaultPanelInfill',
                  message: 'Default panel infill',
                })}
              </span>
              <SegmentedControl
                value={config.panelType}
                mixed={mixedField('panelType')}
                options={GLAZING_INFILL_OPTIONS.map((option) => ({
                  ...option,
                  label: i18n._(option.label),
                }))}
                onChange={(panelType) => update({ panelType })}
              />
            </div>
            <ToggleControl
              label={i18n._({
                id: 'node.roof.glazingPanel.closeTheRoofEnds',
                message: 'Close the roof ends',
              })}
              checked={config.glazedEnds}
              mixed={mixedField('glazedEnds')}
              onChange={(glazedEnds) => update({ glazedEnds })}
            />
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              {i18n._({
                id: 'node.roof.glazingPanel.endInfillFillsTheSpaceAbove',
                message:
                  'End infill fills the space above the walls. Edit room walls and ceilings separately.',
              })}
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
