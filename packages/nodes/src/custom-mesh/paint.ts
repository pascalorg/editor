import type { PaintPreviewArgs, PaintResolveArgs } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'
import { CUSTOM_MESH_BODY_SLOT_ID } from './material-slots'

function resolveCustomMeshPaintRole(args: PaintResolveArgs): string | null {
  const slotIds = (args.hitObject?.userData as { slotIds?: unknown } | undefined)?.slotIds
  if (!Array.isArray(slotIds)) return null
  const slotId = slotIds[args.materialIndex ?? 0]
  return typeof slotId === 'string' ? slotId : null
}

function previewCustomMeshSlot(args: PaintPreviewArgs): (() => void) | null {
  const preview = buildSlotPreviewMaterial(args.material, args.materialPreset)
  if (!preview) return () => {}

  const restores: Array<() => void> = []
  ;(args.root as Object3D).traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || mesh.userData.__fromGeometry !== true) return
    const userData = mesh.userData as { slotIds?: unknown; bodyFallbackSlotIds?: unknown }
    const slotIds = userData.slotIds
    if (!Array.isArray(slotIds)) return
    const bodyFallbackSlotIds = new Set(
      Array.isArray(userData.bodyFallbackSlotIds) ? userData.bodyFallbackSlotIds : [],
    )
    const materialIndices = slotIds.flatMap((slotId, index) =>
      slotId === args.role ||
      (args.role === CUSTOM_MESH_BODY_SLOT_ID && bodyFallbackSlotIds.has(slotId))
        ? [index]
        : [],
    )
    if (materialIndices.length === 0) return

    const previous = mesh.material
    const next = Array.isArray(previous) ? previous.slice() : slotIds.map(() => previous)
    for (const materialIndex of materialIndices) next[materialIndex] = preview
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

export const customMeshPaint = createSlotPaintCapability({
  resolveRole: resolveCustomMeshPaintRole,
  applyPreview: previewCustomMeshSlot,
})
