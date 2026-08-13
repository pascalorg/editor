import { Plane, Vector3 } from 'three/webgpu'

/**
 * Cutting planes applied to the whole rendered scene subtree.
 *
 * This is deliberately a bare list of planes rather than anything that knows
 * *why* the scene is being cut: the viewer stays ignorant of section-plane
 * nodes, and whoever owns that concept (the `section-plane` kind's system)
 * pushes equations in here.
 *
 * Under `WebGPURenderer` clipping is driven by `ClippingGroup` in the scene
 * graph — `renderer.localClippingEnabled` and `material.clippingPlanes` are
 * WebGL-only and do nothing here. `<SceneRenderer>` hands this array to its
 * `ClippingGroup`, and the renderer re-reads the plane values every frame, so
 * mutating them in place moves the cut without a React re-render. That is what
 * keeps a plane drag at frame rate.
 */
export const sceneClippingPlanes: Plane[] = []

export type SceneClippingPlaneInput = {
  normal: readonly [number, number, number]
  constant: number
}

const scratchNormal = new Vector3()

/**
 * Replace the active cut with `next`, reusing the existing `Plane` instances so
 * the common case (one plane being dragged) allocates nothing.
 */
export function setSceneClippingPlanes(next: readonly SceneClippingPlaneInput[]): void {
  for (let index = 0; index < next.length; index++) {
    const input = next[index]
    if (!input) continue
    const { normal, constant } = input
    scratchNormal.set(normal[0], normal[1], normal[2])
    const existing = sceneClippingPlanes[index]
    if (existing) existing.set(scratchNormal, constant)
    else sceneClippingPlanes.push(new Plane(scratchNormal.clone(), constant))
  }

  if (sceneClippingPlanes.length > next.length) sceneClippingPlanes.length = next.length
}

/** Leave the scene uncut. */
export function clearSceneClippingPlanes(): void {
  sceneClippingPlanes.length = 0
}
