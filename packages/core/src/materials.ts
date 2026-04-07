import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'

/**
 * Shared base material for structural elements: walls, frames, slabs, roof.
 */
export const baseMaterial = new MeshStandardNodeMaterial({
  color: '#f2f0ed',
  roughness: 0.5,
  metalness: 0,
})

/**
 * Shared glass material for windows, glazed door panels, and glass items.
 */
export const glassMaterial = new MeshStandardNodeMaterial({
  name: 'glass',
  color: 'lightblue',
  roughness: 0.05,
  metalness: 0.1,
  transparent: true,
  opacity: 0.35,
  side: DoubleSide,
  depthWrite: false,
})
