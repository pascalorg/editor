'use client'

import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useLayoutEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, Line as ThreeLine } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import type { PlacementPreviewDimension } from '../../../store/use-placement-preview'
import usePlacementPreview from '../../../store/use-placement-preview'
import { formatMeasurement } from '../../editor/measurement-pill'

const DIMENSION_COLOR = 0x63_66_f1
const dimensionMaterial = new LineBasicNodeMaterial({
  color: DIMENSION_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})

export function PlacementDimensionGuides() {
  const dimensions = usePlacementPreview((state) => state.dimensions)
  const activeDimensionId = usePlacementPreview((state) => state.activeDimensionId)
  const dimensionInput = usePlacementPreview((state) => state.dimensionInput)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  if (dimensions.length === 0) return null

  return (
    <>
      {dimensions
        .filter((dimension) => dimension.renderIn3d !== false)
        .map((dimension) => (
          <PlacementDimensionGuide
            dimension={dimension}
            dimensionInput={dimension.id === activeDimensionId ? dimensionInput : null}
            key={dimension.id}
            metricNotation={metricNotation}
            unit={unit}
          />
        ))}
    </>
  )
}

function PlacementDimensionGuide({
  dimension,
  dimensionInput,
  metricNotation,
  unit,
}: {
  dimension: PlacementPreviewDimension
  dimensionInput: string | null
  metricNotation: 'meters' | 'millimeters'
  unit: 'metric' | 'imperial'
}) {
  const { line, position } = useMemo(() => {
    const position = new Float32BufferAttribute(new Float32Array(6), 3)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', position)
    const line = new ThreeLine(geometry, dimensionMaterial)
    line.frustumCulled = false
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 1000
    return { line, position }
  }, [])

  const start = useMemo(
    () =>
      [
        dimension.start[0] + dimension.offsetNormal[0] * dimension.offsetDistance,
        dimension.start[1],
        dimension.start[2] + dimension.offsetNormal[1] * dimension.offsetDistance,
      ] as [number, number, number],
    [dimension.offsetDistance, dimension.offsetNormal, dimension.start],
  )
  const end = useMemo(
    () =>
      [
        dimension.end[0] + dimension.offsetNormal[0] * dimension.offsetDistance,
        dimension.end[1],
        dimension.end[2] + dimension.offsetNormal[1] * dimension.offsetDistance,
      ] as [number, number, number],
    [dimension.end, dimension.offsetDistance, dimension.offsetNormal],
  )
  useLayoutEffect(() => {
    position.setXYZ(0, ...start)
    position.setXYZ(1, ...end)
    position.needsUpdate = true
  }, [end, position, start])

  useLayoutEffect(() => () => line.geometry.dispose(), [line])
  return (
    <>
      <primitive object={line} />
      <Html
        center
        position={[
          (start[0] + end[0]) / 2,
          (start[1] + end[1]) / 2 + 0.015,
          (start[2] + end[2]) / 2,
        ]}
        style={{ pointerEvents: 'auto', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div
          className={`rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow-sm ${
            dimensionInput !== null ? 'bg-indigo-700 ring-1 ring-indigo-200' : 'bg-indigo-500/90'
          }`}
          onClick={(event) => {
            event.stopPropagation()
            usePlacementPreview.getState().selectDimension(dimension.id)
          }}
          style={{ cursor: 'text', pointerEvents: 'auto' }}
        >
          {dimensionInput || formatMeasurement(dimension.value, unit, metricNotation)}
        </div>
      </Html>
    </>
  )
}
