'use client'

import {
  type FenceNode,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallCurveLength,
  normalizeWallCurveOffset,
} from '@pascal-app/core'
import { SliderControl } from '@pascal-app/editor'

/**
 * Custom inspector editors for fence fields that don't map to a single
 * node property in the canonical way:
 *
 * - **Length** is derived from `start`/`end`. Adjusting the slider
 *   moves `end` along the existing direction so the fence resizes from
 *   the start point. Matches the legacy `FencePanel`'s "Length" slider.
 * - **Curve** is a slider on `curveOffset` with min/max bounded by the
 *   chord length (per-node), normalized via `normalizeWallCurveOffset`.
 *   Can't use a plain `number` field because the bounds change with
 *   the fence's shape.
 *
 * Both are wired through `parametrics.fields[].kind: 'custom'`.
 */
export function FenceLengthEditor({
  node,
  onUpdate,
}: {
  node: FenceNode
  onUpdate: (patch: Partial<FenceNode>) => void
}) {
  const length = getWallCurveLength(node)

  const handleChange = (newLength: number) => {
    if (newLength <= 0) return
    const dx = node.end[0] - node.start[0]
    const dz = node.end[1] - node.start[1]
    const currentLength = Math.sqrt(dx * dx + dz * dz)
    if (currentLength === 0) return
    const dirX = dx / currentLength
    const dirZ = dz / currentLength
    const newEnd: [number, number] = [
      node.start[0] + dirX * newLength,
      node.start[1] + dirZ * newLength,
    ]
    onUpdate({ end: newEnd })
  }

  return (
    <SliderControl
      label="Length"
      max={50}
      min={0.1}
      onChange={handleChange}
      precision={2}
      step={0.01}
      unit="m"
      value={length}
    />
  )
}

export function FenceCurveEditor({
  node,
  onUpdate,
}: {
  node: FenceNode
  onUpdate: (patch: Partial<FenceNode>) => void
}) {
  const curveOffset = getClampedWallCurveOffset(node)
  const maxCurveOffset = getMaxWallCurveOffset(node)

  return (
    <SliderControl
      label="Curve"
      max={Math.max(0.01, maxCurveOffset)}
      min={-Math.max(0.01, maxCurveOffset)}
      onChange={(value) => onUpdate({ curveOffset: normalizeWallCurveOffset(node, value) })}
      precision={2}
      step={0.1}
      unit="m"
      value={Math.round(curveOffset * 100) / 100}
    />
  )
}
