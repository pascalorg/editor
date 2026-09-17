import type { AnyNode, LinearResizeHandle, RadialResizeHandle, SceneApi } from '@pascal-app/core'

export function resolveLinearHandlePosition<N>(
  descriptor: LinearResizeHandle<N> | RadialResizeHandle<N>,
  node: N,
  scene: SceneApi,
  baseScale: number,
): readonly [number, number, number] {
  const position = descriptor.placement.position(node, scene)
  const clearance = descriptor.kind === 'linear-resize' ? descriptor.placement.clearance : undefined
  if (!clearance) return position
  const index = descriptor.axis === 'x' ? 0 : descriptor.axis === 'y' ? 1 : 2
  const result: [number, number, number] = [...position]
  const direction = descriptor.kind === 'linear-resize' ? (descriptor.direction ?? 1) : 1
  const edge = clearance.edge(node, scene) + direction * clearance.distance * baseScale
  result[index] = direction === -1 ? Math.min(result[index], edge) : Math.max(result[index], edge)
  return result
}

export function resolveLinearHandleRotation<N>(
  descriptor: LinearResizeHandle<N> | RadialResizeHandle<N>,
  position: readonly [number, number, number],
): [number, number, number] {
  const direction = descriptor.kind === 'linear-resize' ? descriptor.direction : undefined
  if (descriptor.axis === 'y') {
    const sign = direction ?? (position[1] < 0 ? -1 : 1)
    return [0, Math.PI / 2, (sign * Math.PI) / 2]
  }
  const faceNormal =
    descriptor.kind === 'linear-resize' && descriptor.axis === 'x' && descriptor.faceNormal
  return [faceNormal ? Math.PI / 2 : 0, 0, direction === -1 ? Math.PI : 0]
}

// Offset, in node-local frame, that compensates for `position` drift on
// the mesh during an asymmetric resize. Width/length L+R recompute
// `position` so the anchored edge stays world-fixed — the renderer
// follows that override, the ride object moves, and every arrow under
// it would drift along with the mesh center. Subtracting this offset
// from a non-active arrow's local placement undoes that drift so it
// stays at its pre-drag world position.
//
// Rotation drags don't change `position`, so the offset collapses to
// zero and non-active arrows naturally rotate with the mesh — which is
// the desired behaviour (the whole rig rotates as a unit).
export function computeFreezeOffset(
  liveNode: AnyNode,
  preDragNode: AnyNode,
): [number, number, number] {
  // Not every node in the union carries a `position` field (sites are the
  // notable holdout — they don't have handles anyway, but TypeScript still
  // requires us to discriminate). Guarded access keeps the freeze logic
  // safe for the few node kinds that lack the field.
  const liveP = (liveNode as { position?: readonly [number, number, number] }).position ?? [0, 0, 0]
  const preP = (preDragNode as { position?: readonly [number, number, number] }).position ?? [
    0, 0, 0,
  ]
  const deltaWorldX = liveP[0] - preP[0]
  const deltaWorldY = liveP[1] - preP[1]
  const deltaWorldZ = liveP[2] - preP[2]
  const rotation = (preDragNode as { rotation?: number | readonly number[] }).rotation
  const rotY = typeof rotation === 'number' ? rotation : (rotation?.[1] ?? 0)
  // World → node-local for Y-axis rotation by rotY (THREE.Object3D
  // rotation-y convention): inverse is rotation by -rotY around +Y.
  const cosR = Math.cos(rotY)
  const sinR = Math.sin(rotY)
  const deltaLocalX = cosR * deltaWorldX - sinR * deltaWorldZ
  const deltaLocalZ = sinR * deltaWorldX + cosR * deltaWorldZ
  return [deltaLocalX, deltaWorldY, deltaLocalZ]
}
