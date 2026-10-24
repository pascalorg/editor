import type { SkylightNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export function buildFrameGeometry(
  node: Pick<
    SkylightNode,
    'curb' | 'curbHeight' | 'frameDepth' | 'frameThickness' | 'height' | 'width'
  >,
): THREE.BufferGeometry | null {
  const w = Math.max(0.02, node.width),
    d = Math.max(0.02, node.height)
  const ft = Math.max(0.005, node.frameThickness),
    fd = Math.max(0.005, node.frameDepth)
  const curb = node.curb ? Math.max(0, node.curbHeight) : 0
  const parts: THREE.BufferGeometry[] = []
  const box = (x: number, y: number, z: number, px: number, py: number, pz: number) => {
    const g = new THREE.BoxGeometry(x, y, z)
    g.translate(px, py, pz)
    parts.push(g)
  }
  const ring = (border: number, height: number, y: number) => {
    box(border, height, d + 2 * border, -w / 2 - border / 2, y, 0)
    box(border, height, d + 2 * border, w / 2 + border / 2, y, 0)
    box(w, height, border, 0, y, -d / 2 - border / 2)
    box(w, height, border, 0, y, d / 2 + border / 2)
  }
  ring(ft, fd + curb, (curb - fd) / 2)
  // A thin apron covers the roof cut edge; the raised bead catches light.
  ring(ft + 0.06, 0.008, 0.004)
  ring(ft + 0.008, 0.012, curb + 0.006)
  const geometry = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (geometry) {
    const pos = geometry.getAttribute('position'),
      normal = geometry.getAttribute('normal'),
      uv = geometry.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, pos.getX(i), pos.getZ(i))
      else if (Math.abs(normal.getX(i)) > 0.5) uv.setXY(i, pos.getZ(i), pos.getY(i))
      else uv.setXY(i, pos.getX(i), pos.getY(i))
    }
    geometry.setAttribute('uv2', uv.clone())
  }
  return geometry
}
