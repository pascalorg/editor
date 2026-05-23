'use client'

import {
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallCurveLength,
  normalizeWallCurveOffset,
} from '@pascal-app/core'
import { SliderControl } from '@pascal-app/editor'
import { L } from '../i18n/panel-labels'
import type { PipeNode } from './schema'

export function PipeLengthEditor({
  node,
  onUpdate,
}: {
  node: PipeNode
  onUpdate: (patch: Partial<PipeNode>) => void
}) {
  const length = getWallCurveLength(node)

  const handleChange = (newLength: number) => {
    if (newLength <= 0) return
    const dx = node.end[0] - node.start[0]
    const dz = node.end[1] - node.start[1]
    const currentLength = Math.hypot(dx, dz)
    if (currentLength === 0) return
    const dirX = dx / currentLength
    const dirZ = dz / currentLength
    onUpdate({
      end: [node.start[0] + dirX * newLength, node.start[1] + dirZ * newLength],
    })
  }

  return (
    <SliderControl
      label={L.length()}
      max={80}
      min={0.1}
      onChange={handleChange}
      precision={2}
      step={0.05}
      unit="m"
      value={length}
    />
  )
}

export function PipeCurveEditor({
  node,
  onUpdate,
}: {
  node: PipeNode
  onUpdate: (patch: Partial<PipeNode>) => void
}) {
  const curveOffset = getClampedWallCurveOffset(node)
  const maxCurveOffset = getMaxWallCurveOffset(node)

  return (
    <SliderControl
      label={L.curve()}
      max={Math.max(0.01, maxCurveOffset)}
      min={-Math.max(0.01, maxCurveOffset)}
      onChange={(value) => onUpdate({ curveOffset: normalizeWallCurveOffset(node, value) })}
      precision={3}
      step={0.01}
      unit="m"
      value={curveOffset}
    />
  )
}
