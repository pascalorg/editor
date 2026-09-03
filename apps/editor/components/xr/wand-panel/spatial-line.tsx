'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, LineBasicMaterial, type Shape, Line as ThreeLine, Vector3 } from 'three'

export function shapeLinePoints(shape: Shape) {
  const points = shape.getPoints(6).map(({ x, y }) => [x, y, 0.007] as [number, number, number])
  points.push(points[0]!)
  return points
}

export function SpatialLine({
  color,
  lineWidth = 1,
  opacity = 1,
  points,
  renderOrder = 5,
  transparent = false,
}: {
  color: string
  lineWidth?: number
  opacity?: number
  points: readonly [number, number, number][]
  renderOrder?: number
  transparent?: boolean
}) {
  const line = useMemo(
    () =>
      new ThreeLine(
        new BufferGeometry().setFromPoints(points.map(([x, y, z]) => new Vector3(x, y, z))),
        new LineBasicMaterial({
          color,
          linewidth: lineWidth,
          opacity,
          transparent: transparent || opacity < 1,
        }),
      ),
    [color, lineWidth, opacity, points, transparent],
  )

  useEffect(
    () => () => {
      line.geometry.dispose()
      line.material.dispose()
    },
    [line],
  )

  line.layers.set(EDITOR_LAYER)
  line.renderOrder = renderOrder
  return <primitive object={line} raycast={() => undefined} />
}
