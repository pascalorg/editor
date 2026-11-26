import { DoubleSide } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'

let foliage: MeshStandardNodeMaterial | undefined

/**
 * The one material every hedge shares. Its whole look is the vertex colour its generator bakes
 * (leaf tone, patches, the shade it keeps toward its base): no texture is sampled and no UV is
 * read, so a hedge costs a lit material no sampled texture. Both faces are drawn because a leaf
 * is one sheet of two triangles.
 */
export function hedgeMaterial(): MeshStandardNodeMaterial {
  if (!foliage) {
    foliage = new MeshStandardNodeMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0,
      side: DoubleSide,
    })
    foliage.name = 'hedge-foliage'
  }
  return foliage
}
