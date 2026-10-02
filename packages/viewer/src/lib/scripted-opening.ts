import type * as THREE from 'three'

/** The group a scripted window or door renders its artifact into; the opening's system leaves it alone. */
export const SCRIPTED_MODEL_FLAG = 'scriptedModel'

/**
 * A window or door built from a script renders its artifact, not the
 * parametric frame: drop what an earlier parametric build left under the
 * mesh, and report whether the artifact has loaded (until then the node
 * stays dirty, so scene-ready and bakes wait for it, as for items).
 */
export function settleScriptedOpening(mesh: THREE.Object3D): boolean {
  let settled = false
  for (const child of [...mesh.children]) {
    if (child.userData[SCRIPTED_MODEL_FLAG]) {
      settled = child.userData.itemModelSettled === true
      continue
    }
    mesh.remove(child)
    child.traverse((object) => (object as THREE.Mesh).geometry?.dispose())
  }
  return settled
}
