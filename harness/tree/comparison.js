import * as THREE from 'three/webgpu'

const PRESETS = {
  round: 'Oak Medium',
  spreading: 'Oak Large',
  upright: 'Aspen Medium',
  conifer: 'Pine Medium',
  weeping: 'Ash Large',
  multistem: 'Ash Medium',
}

let reference

export async function loadReference() {
  // The library starts loading its embedded textures during module evaluation.
  const manager = THREE.DefaultLoadingManager
  const { onLoad, onError } = manager
  const texturesReady = new Promise((resolve, reject) => {
    manager.onLoad = resolve
    manager.onError = () => reject(new Error('A reference tree texture failed to load'))
  })
  try {
    const [library] = await Promise.all([import('/ez-tree.js'), texturesReady])
    reference = library
  } finally {
    manager.onLoad = onLoad
    manager.onError = onError
  }
}

export function referenceTree(form, height, seed) {
  const preset = PRESETS[form]
  const options = structuredClone(reference.TreePreset[preset])
  if (seed !== undefined) options.seed = seed
  const tree = new reference.Tree()
  tree.loadFromJson(options)
  const bounds = new THREE.Box3().setFromObject(tree, true)
  tree.scale.setScalar(height / (bounds.max.y - bounds.min.y))
  tree.position.y = -bounds.min.y * tree.scale.y
  return { tree, preset, referenceSeed: options.seed }
}

function rgbaBytes(texture) {
  let { width, height } = texture.image
  let bytes = 0
  for (;;) {
    bytes += width * height * 4
    if (!texture.generateMipmaps || (width === 1 && height === 1)) return bytes
    width = Math.max(1, Math.floor(width / 2))
    height = Math.max(1, Math.floor(height / 2))
  }
}

export function measureTree(root) {
  let triangles = 0
  let draws = 0
  const textures = new Set()
  root.traverse((mesh) => {
    if (!mesh.isMesh) return
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3
    draws += Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials)
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
  })
  return {
    triangles,
    draws,
    textures: textures.size,
    textureBytes: [...textures].reduce((sum, texture) => sum + rgbaBytes(texture), 0),
  }
}
