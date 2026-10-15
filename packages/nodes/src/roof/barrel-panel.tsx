'use client'

import {
  getActiveRoofHeight,
  getEffectiveNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import {
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  PanelSection,
  SliderControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { createRoofGlazingPreview } from './glazing-preview'

export function BarrelRoofPanel({ node: stored }: { node: RoofSegmentNode }) {
  useLiveNodeOverrides((state) => state.overrides.get(stored.id))
  const node = getEffectiveNode(stored)
  const unit = useViewer((state) => state.unit)
  const preview = useMemo(() => createRoofGlazingPreview([stored.id]), [stored.id])
  useEffect(() => () => preview.cancel(), [preview])
  return (
    <PanelSection title="Barrel arch">
      <SliderControl
        label="Rise"
        min={metersToLinearUnit(0.01, unit)}
        max={metersToLinearUnit(node.depth / 2, unit)}
        step={0.1}
        precision={2}
        unit={getLinearUnitLabel(unit)}
        value={metersToLinearUnit(getActiveRoofHeight(node), unit)}
        onChange={(value) =>
          preview.previewFields({
            barrelRise: Math.min(
              node.depth / 2,
              linearControlValueToMeters(value, unit, { minMeters: 0.01 }),
            ),
          })
        }
        onCommit={preview.finish}
        onCancel={preview.cancel}
        restoreOnCommit={false}
        previewWhileTyping
      />
      <SliderControl
        label="Arch bays"
        min={4}
        max={32}
        step={1}
        precision={0}
        value={node.barrelSegments ?? 12}
        onChange={(value) => preview.previewFields({ barrelSegments: Math.round(value) })}
        onCommit={preview.finish}
        onCancel={preview.cancel}
        restoreOnCommit={false}
        previewWhileTyping
      />
      <p className="px-1 text-xs text-muted-foreground">
        Flat panes follow a circular arch. Rise is measured from the eaves.
      </p>
    </PanelSection>
  )
}
