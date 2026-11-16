import { DoubleSide } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { rockColorNode } from '../rock/material'

const FACE_COLOR = { cliff: '#a49d90', retaining: '#939089', soil: '#7a6248' } as const

export function terrainBreakMaterial(kind: 'cliff' | 'retaining' | 'soil') {
  const material = new MeshStandardNodeMaterial({
    color: FACE_COLOR[kind],
    roughness: kind === 'soil' ? 0.98 : 0.92,
    metalness: 0,
    side: DoubleSide,
  })
  if (kind === 'cliff') material.colorNode = rockColorNode({ strata: true, lichen: 0 })
  return material
}
