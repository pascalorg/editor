import type { EvaluatedLight } from '@pascal-app/core/procedural-items'
import type { Color, Material, Mesh, Object3D } from 'three'

type EmissiveMaterial = Material & {
  emissive?: Color
  emissiveIntensity?: number
  emissiveMap?: unknown
}

export function cloneWithProceduralEmission(
  material: Material,
  color: string,
  on: boolean,
): Material {
  const clone = material.clone() as EmissiveMaterial
  clone.userData = { ...clone.userData, __pascalCachedMaterial: false }
  if (clone.emissive) clone.emissive.set(color)
  if ('emissiveIntensity' in clone) clone.emissiveIntensity = on ? 1 : 0
  if ('emissiveMap' in clone) clone.emissiveMap = null
  clone.needsUpdate = true
  return clone
}

export function setProceduralEmission(material: Material, on: boolean): void {
  const controlled = material as EmissiveMaterial
  if ('emissiveIntensity' in controlled) controlled.emissiveIntensity = on ? 1 : 0
}

export function proceduralSlotMeshes(root: Object3D, slots: Set<string>): Mesh[] {
  const meshes: Mesh[] = []
  const owner = root.userData.pascalId
  const visit = (object: Object3D) => {
    if (object !== root && object.userData.pascalId && object.userData.pascalId !== owner) return
    const mesh = object as Mesh
    if (mesh.isMesh && slots.has(mesh.userData.slotId)) meshes.push(mesh)
    for (const child of object.children) visit(child)
  }
  visit(root)
  return meshes
}

export function decorateProceduralEmission(
  root: Object3D,
  lights: EvaluatedLight[],
  on: boolean,
): () => void {
  const colors = new Map(
    lights.flatMap((light) =>
      light.emissiveSlot ? [[light.emissiveSlot, light.color] as const] : [],
    ),
  )
  const restores: Array<() => void> = []
  for (const mesh of proceduralSlotMeshes(root, new Set(colors.keys()))) {
    const slot = mesh.userData.slotId as string
    const color = colors.get(slot)
    if (!color) continue
    const previous = mesh.material
    const clones = (Array.isArray(previous) ? previous : [previous]).map((material) =>
      cloneWithProceduralEmission(material, color, on),
    )
    mesh.material = Array.isArray(previous) ? clones : clones[0]!
    restores.push(() => {
      mesh.material = previous
      for (const clone of clones) clone.dispose()
    })
  }
  return () => {
    for (const restore of restores) restore()
  }
}
