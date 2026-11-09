import type { Material, Mesh, Object3D } from 'three'

/**
 * A faded stand-in for a mesh's materials, for a node that lifts out of the way mid-build (a roof
 * over the furniture dropping in). The scene's materials are shared and cached by their catalog
 * entry (the walls' trim and a roof's drywall can be one object), so a fade never writes to them:
 * each mesh wears clones while it is a ghost, and gets its own materials back after.
 */

type Worn = {
  original: Material | Material[]
  ghost: Material | Material[]
  /** Whether the mesh cast a shadow before it faded. */
  cast: boolean
}

const worn = new WeakMap<Mesh, Worn>()

/** Under this a ghost casts no shadow and writes no depth: the rooms below are lit and seen. */
const FAINT = 0.5

const cloneAll = (material: Material | Material[]) =>
  Array.isArray(material) ? material.map((each) => each.clone()) : material.clone()

const eachOf = (material: Material | Material[]) =>
  Array.isArray(material) ? material : [material]

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true && Boolean((object as Mesh).material)
}

/**
 * Fades everything drawn under `root` to `opacity`. Idempotent: a frame later it only moves the
 * opacity, and a renderer that put its own materials back is dressed again. At 1 it is whole.
 */
export function setGhost(root: Object3D, opacity: number): void {
  if (opacity >= 0.999) {
    clearGhost(root)
    return
  }
  root.traverse((child) => {
    if (!isMesh(child)) return
    let entry = worn.get(child)
    if (entry && child.material !== entry.ghost) {
      // Its renderer set the real materials again: they are the originals now.
      for (const material of eachOf(entry.ghost)) material.dispose()
      entry = { original: child.material, ghost: cloneAll(child.material), cast: entry.cast }
      worn.set(child, entry)
      child.material = entry.ghost
    } else if (!entry) {
      entry = { original: child.material, ghost: cloneAll(child.material), cast: child.castShadow }
      worn.set(child, entry)
      child.material = entry.ghost
    }
    for (const material of eachOf(entry.ghost)) {
      // A material that turns transparent compiles anew once: the flag and the write order change.
      if (!material.transparent) {
        material.transparent = true
        material.needsUpdate = true
      }
      material.opacity = opacity
      material.depthWrite = opacity > FAINT
    }
    child.castShadow = opacity > FAINT && entry.cast
  })
}

/** Gives every mesh under `root` its own materials and its shadow back. */
export function clearGhost(root: Object3D): void {
  root.traverse((child) => {
    if (!isMesh(child)) return
    const entry = worn.get(child)
    if (!entry) return
    if (child.material === entry.ghost) child.material = entry.original
    for (const material of eachOf(entry.ghost)) material.dispose()
    child.castShadow = entry.cast
    worn.delete(child)
  })
}
