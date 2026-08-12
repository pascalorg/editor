import type { CustomMeshTopology, MaterialRef } from '@pascal-app/core'

export const CUSTOM_MESH_BODY_SLOT_ID = 'body'

export type CustomMeshMaterialSlots = Record<string, MaterialRef> | undefined

export type CustomMeshMaterialSelection =
  | { kind: 'empty'; activeSlotId: null }
  | { kind: 'single'; activeSlotId: string; slotId: string }
  | { kind: 'mixed'; activeSlotId: string | null }

export type CustomMeshMaterialAssignment =
  | { kind: 'slot'; slotId: string }
  | { kind: 'material'; materialRef: MaterialRef }

export type CustomMeshMaterialAssignmentResult = {
  topology: CustomMeshTopology
  slots: CustomMeshMaterialSlots
  slotId: string
  changed: boolean
}

export type CustomMeshMaterialSlotCleanupResult = {
  slots: CustomMeshMaterialSlots
  removedSlotIds: string[]
  changed: boolean
}

export function customMeshMaterialSlotIds(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
): string[] {
  const slotIds = new Set<string>([CUSTOM_MESH_BODY_SLOT_ID])
  for (const slotId of Object.keys(slots ?? {})) slotIds.add(slotId)
  for (const face of topology.faces) slotIds.add(face.materialSlot)
  return [...slotIds]
}

export function customMeshMaterialSelection(
  topology: CustomMeshTopology,
  selectedFaceIds: readonly string[],
  activeFaceId: string | null,
): CustomMeshMaterialSelection {
  const selected = new Set(selectedFaceIds)
  const selectedFaces = topology.faces.filter((face) => selected.has(face.id))
  const firstSelectedFace = selectedFaces[0]
  if (!firstSelectedFace) return { kind: 'empty', activeSlotId: null }

  const firstSlotId = firstSelectedFace.materialSlot
  const activeSlotId =
    topology.faces.find((face) => face.id === activeFaceId && selected.has(face.id))
      ?.materialSlot ?? null

  if (selectedFaces.every((face) => face.materialSlot === firstSlotId)) {
    return {
      kind: 'single',
      slotId: firstSlotId,
      activeSlotId: activeSlotId ?? firstSlotId,
    }
  }
  return { kind: 'mixed', activeSlotId }
}

export function unusedCustomMeshMaterialSlotIds(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
): string[] {
  const used = new Set<string>([
    CUSTOM_MESH_BODY_SLOT_ID,
    ...topology.faces.map((face) => face.materialSlot),
  ])
  return Object.keys(slots ?? {}).filter((slotId) => !used.has(slotId))
}

export function removeUnusedCustomMeshMaterialSlots(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
): CustomMeshMaterialSlotCleanupResult {
  const removedSlotIds = unusedCustomMeshMaterialSlotIds(topology, slots)
  if (removedSlotIds.length === 0) return { slots, removedSlotIds, changed: false }

  const removed = new Set(removedSlotIds)
  const retainedEntries = Object.entries(slots ?? {}).filter(([slotId]) => !removed.has(slotId))
  return {
    slots: retainedEntries.length > 0 ? Object.fromEntries(retainedEntries) : undefined,
    removedSlotIds,
    changed: true,
  }
}

export function selectCustomMeshFacesByMaterialSlot(
  topology: CustomMeshTopology,
  selectedFaceIds: readonly string[],
  slotId: string,
  operation: 'select' | 'deselect',
): string[] {
  const matching = new Set(
    topology.faces.filter((face) => face.materialSlot === slotId).map((face) => face.id),
  )
  if (operation === 'deselect') {
    return selectedFaceIds.filter((faceId) => !matching.has(faceId))
  }

  const selected = new Set(selectedFaceIds)
  return [
    ...selectedFaceIds,
    ...topology.faces
      .filter((face) => matching.has(face.id) && !selected.has(face.id))
      .map((face) => face.id),
  ]
}

function findSlotIdForMaterialRef(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
  materialRef: MaterialRef,
): string | null {
  return (
    customMeshMaterialSlotIds(topology, slots).find((slotId) => slots?.[slotId] === materialRef) ??
    null
  )
}

function allocateMaterialSlotId(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
): string {
  const used = new Set(customMeshMaterialSlotIds(topology, slots))
  let index = 1
  while (used.has(`material-${index}`)) index += 1
  return `material-${index}`
}

export function assignCustomMeshMaterial(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
  selectedFaceIds: readonly string[],
  assignment: CustomMeshMaterialAssignment,
): CustomMeshMaterialAssignmentResult {
  const selected = new Set(selectedFaceIds)
  const hasSelectedFace = topology.faces.some((face) => selected.has(face.id))
  let nextSlots = slots
  let slotId: string

  if (assignment.kind === 'slot') {
    slotId = assignment.slotId
    if (!customMeshMaterialSlotIds(topology, slots).includes(slotId)) {
      return { topology, slots, slotId, changed: false }
    }
  } else {
    const existingSlotId = findSlotIdForMaterialRef(topology, slots, assignment.materialRef)
    slotId = existingSlotId ?? allocateMaterialSlotId(topology, slots)
    if (!existingSlotId && hasSelectedFace) {
      nextSlots = { ...slots, [slotId]: assignment.materialRef }
    }
  }

  if (!hasSelectedFace) return { topology, slots, slotId, changed: false }
  if (topology.faces.every((face) => !selected.has(face.id) || face.materialSlot === slotId)) {
    return { topology, slots, slotId, changed: false }
  }

  return {
    topology: {
      ...topology,
      faces: topology.faces.map((face) =>
        selected.has(face.id) ? { ...face, materialSlot: slotId } : face,
      ),
    },
    slots: nextSlots,
    slotId,
    changed: true,
  }
}
