import type { AnyNode, PaintPreviewArgs, PaintResolveArgs, StairNode } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'
import type { StairSlotId } from './slots'

function isStairSlotId(value: unknown): value is StairSlotId {
  return value === 'treads' || value === 'body' || value === 'railing'
}

function resolveStairPaintRole(args: PaintResolveArgs): StairSlotId | null {
  const userData = args.hitObject?.userData as { slotId?: unknown; slotIds?: unknown } | undefined

  if (isStairSlotId(userData?.slotId)) {
    return userData.slotId
  }

  if (Array.isArray(userData?.slotIds)) {
    const slotId = userData.slotIds[args.materialIndex ?? 0]
    return isStairSlotId(slotId) ? slotId : null
  }

  return null
}

function previewStairSlot(args: PaintPreviewArgs): (() => void) | null {
  const { role, root, material, materialPreset } = args
  if (!isStairSlotId(role)) return null

  const preview = buildSlotPreviewMaterial(material, materialPreset)
  if (!preview) return () => {}

  const restores: Array<() => void> = []
  ;(root as Object3D).traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return

    const userData = mesh.userData as { slotId?: unknown; slotIds?: unknown }
    if (userData.slotId === role) {
      const previous = mesh.material
      mesh.material = preview
      restores.push(() => {
        mesh.material = previous
      })
      return
    }

    if (!Array.isArray(userData.slotIds)) return
    const materialIndex = userData.slotIds.indexOf(role)
    if (materialIndex < 0) return
    if (!Array.isArray(mesh.material)) return

    const previous = mesh.material
    const next = previous.slice()
    next[materialIndex] = preview
    mesh.material = next
    restores.push(() => {
      mesh.material = previous
    })
  })

  if (restores.length === 0) return null
  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
  }
}

function legacyEffective(node: AnyNode, role: string) {
  if (!isStairSlotId(role)) return null

  const stair = node as StairNode
  const perSlot =
    role === 'treads'
      ? { material: stair.treadMaterial, materialPreset: stair.treadMaterialPreset }
      : role === 'body'
        ? { material: stair.sideMaterial, materialPreset: stair.sideMaterialPreset }
        : { material: stair.railingMaterial, materialPreset: stair.railingMaterialPreset }

  if (perSlot.material !== undefined || typeof perSlot.materialPreset === 'string') {
    return {
      material: perSlot.material,
      materialPreset:
        typeof perSlot.materialPreset === 'string' ? perSlot.materialPreset : undefined,
    }
  }

  if (stair.material !== undefined || typeof stair.materialPreset === 'string') {
    return {
      material: stair.material,
      materialPreset: typeof stair.materialPreset === 'string' ? stair.materialPreset : undefined,
    }
  }

  return null
}

export const stairPaint = createSlotPaintCapability({
  resolveRole: resolveStairPaintRole,
  applyPreview: previewStairSlot,
  legacyEffective,
})
