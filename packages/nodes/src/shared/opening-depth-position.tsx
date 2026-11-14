'use client'

import {
  type DoorNode,
  resolveOpeningCasingHost,
  usePascalI18n,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { SliderControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

const INCH = 0.0254

/**
 * The Frame section's Depth position: where the frame stands across its wall,
 * the opening's `position[2]` (0 = the wall's centre plane), within half the
 * wall's thickness either way. In inches on an imperial plan, like the casing
 * width (feet would show 2 in as 0.17). Nothing where the opening stands in no
 * wall: a roof face, a curtain wall or railing, a unit built from a script.
 */
export function OpeningDepthPositionControl({
  node,
  onUpdate,
}: {
  node: DoorNode | WindowNode
  onUpdate: (patch: Pick<DoorNode, 'position'>) => void
}) {
  const i18n = usePascalI18n()
  // A number, so only a change to the host wall's thickness re-renders the panel.
  const thickness = useScene((state) =>
    node.roofSegmentId ? null : (resolveOpeningCasingHost(node, state.nodes)?.thickness ?? null),
  )
  const imperial = useViewer((state) => state.unit) === 'imperial'
  if (thickness === null) return null

  const offset = node.position[2] ?? 0
  // An opening already set further out (a photo-profiled slider) keeps its value in range.
  const half = Math.max(thickness / 2, Math.abs(offset))
  const toShown = (meters: number) => (imperial ? meters / INCH : meters)

  return (
    <SliderControl
      label={i18n._({
        id: 'node.shared.openingDepthPosition.depthPosition',
        message: 'Depth position',
      })}
      max={toShown(half)}
      min={toShown(-half)}
      onChange={(value) => {
        const meters = imperial ? value * INCH : value
        onUpdate({
          position: [node.position[0], node.position[1], Math.min(Math.max(meters, -half), half)],
        })
      }}
      precision={imperial ? 2 : 3}
      step={imperial ? 0.25 : 0.005}
      unit={imperial ? 'in' : 'm'}
      value={toShown(offset)}
    />
  )
}
