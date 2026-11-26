'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useMemo, useState } from 'react'
import { type ColorRepresentation, NormalBlending } from 'three'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { Line2 } from 'three/addons/lines/webgpu/Line2.js'
import { Fn, materialColor, materialOpacity, uv, vec4 } from 'three/tsl'
import { Line2NodeMaterial } from 'three/webgpu'

function createGardenPreviewMaterial() {
  const material = new Line2NodeMaterial({ blending: NormalBlending, alphaToCoverage: false })
  // Stock transparent fat lines sample the opaque framebuffer; editor overlays composite separately.
  material.fragmentNode = Fn(() => {
    const lineUv = uv()
    const capY = lineUv.y.abs().sub(1).max(0)
    lineUv.x.mul(lineUv.x).add(capY.mul(capY)).greaterThan(1).discard()
    return vec4(materialColor.rgb, materialOpacity)
  })()
  return material
}

export function GardenPreviewLine({
  points,
  color,
  lineWidth,
  opacity = 1,
}: {
  points: [number, number, number][]
  color: ColorRepresentation
  lineWidth: number
  opacity?: number
}) {
  const geometry = useMemo(() => new LineGeometry().setPositions(points.flat()), [points])
  const [material] = useState(createGardenPreviewMaterial)
  const line = useMemo(() => new Line2(geometry, material), [geometry, material])

  // R3F does not dispose primitives. Geometry changes with the cursor; material lives until unmount.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return (
    <primitive
      dispose={null}
      layers={EDITOR_LAYER}
      object={line}
      raycast={() => {}}
      userData={{ pascalExport: 'strip' }}
    >
      <primitive
        attach="material"
        color={color}
        depthTest={false}
        linewidth={lineWidth}
        object={material}
        opacity={opacity}
        transparent={opacity < 1}
        worldUnits={false}
      />
    </primitive>
  )
}
