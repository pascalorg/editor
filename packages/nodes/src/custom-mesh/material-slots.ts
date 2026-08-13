import {
  type CustomMeshTopology,
  type MaterialRef,
  parseMaterialRef,
  toSceneMaterialRef,
} from '@pascal-app/core'

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

export type CustomMeshMaterialSlotRemovalResult = {
  topology: CustomMeshTopology
  slots: CustomMeshMaterialSlots
  fallbackSlotId: string
  changed: boolean
}

function materialSlotsFromNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || !('slots' in node)) return null
  const slots = (node as { slots?: unknown }).slots
  return slots && typeof slots === 'object' && !Array.isArray(slots)
    ? (slots as Record<string, unknown>)
    : null
}

export function collectReusableCustomMeshMaterialRefs(
  nodes: readonly unknown[],
  sceneMaterialIds: readonly string[],
): MaterialRef[] {
  const refs = new Set<MaterialRef>()
  for (const node of nodes) {
    const slots = materialSlotsFromNode(node)
    if (!slots) continue
    for (const value of Object.values(slots)) {
      if (typeof value === 'string' && parseMaterialRef(value)) refs.add(value)
    }
  }
  for (const id of sceneMaterialIds) refs.add(toSceneMaterialRef(id))
  return [...refs]
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

export function removeCustomMeshMaterialSlot(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
  slotId: string,
): CustomMeshMaterialSlotRemovalResult {
  const slotIds = customMeshMaterialSlotIds(topology, slots)
  const fallbackSlotId = slotIds[0] ?? CUSTOM_MESH_BODY_SLOT_ID
  if (slotId === fallbackSlotId || !slotIds.includes(slotId)) {
    return { topology, slots, fallbackSlotId, changed: false }
  }

  const remapsFaces = topology.faces.some((face) => face.materialSlot === slotId)
  const removesBinding = Object.hasOwn(slots ?? {}, slotId)
  if (!(remapsFaces || removesBinding)) {
    return { topology, slots, fallbackSlotId, changed: false }
  }

  const retainedEntries = Object.entries(slots ?? {}).filter(([candidate]) => candidate !== slotId)
  return {
    topology: remapsFaces
      ? {
          ...topology,
          faces: topology.faces.map((face) =>
            face.materialSlot === slotId ? { ...face, materialSlot: fallbackSlotId } : face,
          ),
        }
      : topology,
    slots: retainedEntries.length > 0 ? Object.fromEntries(retainedEntries) : undefined,
    fallbackSlotId,
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
