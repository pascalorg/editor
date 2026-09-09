import { BackSide, Mesh, MeshBasicMaterial, type Object3D, type Raycaster } from 'three'

const pickingMaterial = new MeshBasicMaterial({ side: BackSide })

export function raycastCeilingUnderside(raycaster: Raycaster, ceiling: Object3D) {
  if (!(ceiling instanceof Mesh)) return []
  // Ignore the transparent top and its grid overlay so drawing can reach surfaces below.
  const proxy = new Mesh(ceiling.geometry, pickingMaterial)
  proxy.matrixWorld.copy(ceiling.matrixWorld)
  proxy.layers.mask = ceiling.layers.mask
  return raycaster.intersectObject(proxy, false).map((hit) => ({ ...hit, object: ceiling }))
}
