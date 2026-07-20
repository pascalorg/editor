'use client'

import { getWallSurfacePolygon, type WallNode } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useMemo } from 'react'
import { ExtrudeGeometry, Shape } from 'three'

const WALL_PREVIEW_HEIGHT = 2.5
const WALL_PREVIEW_THICKNESS = 0.1

export function buildWallPreviewGeometry(
  node: Pick<WallNode, 'start' | 'end' | 'curveOffset' | 'height' | 'thickness'>,
) {
  const polygon = getWallSurfacePolygon({
    start: node.start,
    end: node.end,
    curveOffset: node.curveOffset,
    thickness: node.thickness ?? WALL_PREVIEW_THICKNESS,
  })
  const shape = new Shape()
  polygon.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, -point.y)
    else shape.lineTo(point.x, -point.y)
  })
  shape.closePath()
  const geometry = new ExtrudeGeometry(shape, {
    bevelEnabled: false,
    depth: node.height ?? WALL_PREVIEW_HEIGHT,
    steps: 1,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingBox()
  return geometry
}

const WallPreview = ({ node }: { node: WallNode }) => {
  const { curveOffset, end, height, start, thickness } = node
  const geometry = useMemo(
    () => buildWallPreviewGeometry({ curveOffset, end, height, start, thickness }),
    [curveOffset, end, height, start, thickness],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} layers={EDITOR_LAYER} raycast={() => undefined} renderOrder={1}>
      <meshBasicMaterial
        color="#818cf8"
        depthTest={false}
        depthWrite={false}
        opacity={0.5}
        transparent
      />
    </mesh>
  )
}

export default WallPreview
