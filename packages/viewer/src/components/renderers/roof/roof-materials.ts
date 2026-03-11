import * as THREE from 'three'

// Shared materials for roof and roof-segment renderers.
// Single instances avoid redundant GPU state and material compilation.
export const roofMaterials: THREE.Material[] = [
  new THREE.MeshStandardMaterial({ color: '#eaeaea', roughness: 0.8, side: THREE.DoubleSide }), // 0: Wall
  new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.9, side: THREE.FrontSide }), // 1: Deck
  new THREE.MeshStandardMaterial({ color: '#dddddd', roughness: 0.9, side: THREE.DoubleSide }), // 2: Interior
  new THREE.MeshStandardMaterial({ color: '#4ade80', roughness: 0.9, side: THREE.FrontSide }), // 3: Shingle
]
