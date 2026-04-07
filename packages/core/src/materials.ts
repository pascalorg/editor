import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'

export const baseMaterial = new MeshStandardNodeMaterial({
  name: 'base',
  color: '#f2f0ed',
  roughness: 0.5,
  metalness: 0,
})

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
