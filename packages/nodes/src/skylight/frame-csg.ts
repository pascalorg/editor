import type { SkylightNode } from '@pascal-app/core'
import {
  Brush,
  csgEvaluator,
  csgGeometry,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import * as THREE from 'three'

const visibleDummyMat = new THREE.MeshBasicMaterial()

export function buildFrameGeometry({
  curb,
  curbHeight,
  frameDepth,
  frameThickness,
  height,
  width,
}: Pick<
  SkylightNode,
  'curb' | 'curbHeight' | 'frameDepth' | 'frameThickness' | 'height' | 'width'
>): THREE.BufferGeometry | null {
  const w = width
  const h = height
  const ft = frameThickness
  const fd = frameDepth
  const hasCurb = curb ?? false
  const curbH = hasCurb ? Math.max(0, curbHeight ?? 0.1) : 0

  const outerW = w + 2 * ft
  const outerH = h + 2 * ft
  const totalDepth = fd + curbH

  const outerBox = new THREE.BoxGeometry(outerW, totalDepth, outerH)
  const innerBox = new THREE.BoxGeometry(w, totalDepth + 0.02, h)

  const setupGeo = (geo: THREE.BufferGeometry) => {
    const ic = geo.getIndex()?.count ?? 0
    geo.clearGroups()
    if (ic > 0) geo.addGroup(0, ic, 0)
  }
  setupGeo(outerBox)
  setupGeo(innerBox)

  let frameGeo: THREE.BufferGeometry
  try {
    const outerBrush = new Brush(outerBox, visibleDummyMat as unknown as THREE.MeshStandardMaterial)
    prepareBrushForCSG(outerBrush)
    const innerBrush = new Brush(innerBox, visibleDummyMat as unknown as THREE.MeshStandardMaterial)
    prepareBrushForCSG(innerBrush)
    const result = csgEvaluator.evaluate(outerBrush, innerBrush, SUBTRACTION) as Brush
    frameGeo = csgGeometry(result).clone()
    const ic = frameGeo.getIndex()?.count ?? 0
    frameGeo.clearGroups()
    if (ic > 0) frameGeo.addGroup(0, ic, 0)
    outerBox.dispose()
    innerBox.dispose()
    result.geometry.dispose()
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Skylight frame CSG failed:', e)
    outerBox.dispose()
    innerBox.dispose()
    return null
  }

  frameGeo.translate(0, -totalDepth / 2 + curbH, 0)

  return frameGeo
}
