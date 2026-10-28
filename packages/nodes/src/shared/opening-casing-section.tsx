'use client'

import {
  type DoorNode,
  openingCasingWidth,
  resolveOpeningCasingHost,
  usePascalI18n,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { PanelSection, SliderControl, ToggleControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { openingCasingFaceLabels } from './opening-casing'

const INCH = 0.0254
const MIN_CASING_WIDTH = 0.5 * INCH
const MAX_CASING_WIDTH = 8 * INCH

type CasingPatch = Partial<Pick<DoorNode, 'casingFaceA' | 'casingFaceB' | 'casingWidth'>>

/**
 * The door and window panels' Casing section: casing on or off for each face
 * of the host wall (Exterior and Interior on an outside wall), and the boards'
 * face width, in inches on an imperial plan (feet would show 2 in as 0.17).
 * Nothing where the opening takes no casing (a curtain wall, a dormer face, a
 * unit built from a script).
 */
export function OpeningCasingSection({
  node,
  onUpdate,
}: {
  node: DoorNode | WindowNode
  onUpdate: (patch: CasingPatch) => void
}) {
  const i18n = usePascalI18n()
  // Its own component, so the whole scene it reads for the face names
  // re-renders this section alone, not the panel around it.
  const nodes = useScene((state) => state.nodes)
  const cased = useMemo(() => resolveOpeningCasingHost(node, nodes) !== null, [node, nodes])
  const { parentId, roofSegmentId } = node
  const labels = useMemo(
    () => openingCasingFaceLabels(nodes, { parentId, roofSegmentId }),
    [nodes, parentId, roofSegmentId],
  )
  const imperial = useViewer((state) => state.unit) === 'imperial'
  if (!cased) return null
  const faceA = node.casingFaceA !== false
  const faceB = node.casingFaceB !== false
  const toShown = (meters: number) => (imperial ? meters / INCH : meters)

  return (
    <PanelSection
      title={i18n._({ id: 'node.shared.openingCasingSection.casing', message: 'Casing' })}
    >
      <ToggleControl
        checked={faceA}
        label={labels.a}
        onChange={(checked) => onUpdate({ casingFaceA: checked })}
      />
      <ToggleControl
        checked={faceB}
        label={labels.b}
        onChange={(checked) => onUpdate({ casingFaceB: checked })}
      />
      {(faceA || faceB) && (
        <SliderControl
          label={i18n._({ id: 'node.shared.openingCasingSection.width', message: 'Width' })}
          max={toShown(MAX_CASING_WIDTH)}
          min={toShown(MIN_CASING_WIDTH)}
          onChange={(value) => {
            const meters = imperial ? value * INCH : value
            onUpdate({
              casingWidth: Math.min(Math.max(meters, MIN_CASING_WIDTH), MAX_CASING_WIDTH),
            })
          }}
          precision={imperial ? 2 : 3}
          step={imperial ? 0.25 : 0.005}
          unit={imperial ? 'in' : 'm'}
          value={toShown(openingCasingWidth(node))}
        />
      )}
    </PanelSection>
  )
}
