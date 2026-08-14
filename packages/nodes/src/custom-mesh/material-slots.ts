import {
  type CustomMeshTopology,
  type MaterialRef,
  parseMaterialRef,
  toSceneMaterialRef,
} from '@pascal-app/core'

export const CUSTOM_MESH_BODY_SLOT_ID = 'body'

export type CustomMeshMaterialSlots = Record<string, MaterialRef> | undefined
export type CustomMeshMaterialSlotNames = Record<string, string> | undefined

export type CustomMeshMaterialSelection =
  | { kind: 'empty'; activeSlotId: null }
  | { kind: 'single'; activeSlotId: string; slotId: string }
  | { kind: 'mixed'; activeSlotId: string | null }

export type CustomMeshMaterialAssignment = { kind: 'slot'; slotId: string }

export type CustomMeshMaterialAssignmentResult = {
  topology: CustomMeshTopology
  slots: CustomMeshMaterialSlots
  slotId: string
  changed: boolean
}

export type CustomMeshMaterialSlotRemovalResult = {
  topology: CustomMeshTopology
  slots: CustomMeshMaterialSlots
  slotNames: CustomMeshMaterialSlotNames
  fallbackSlotId: string
  changed: boolean
}

export type CustomMeshMaterialSlotUpdateResult = {
  slots: CustomMeshMaterialSlots
  changed: boolean
}

export type CustomMeshMaterialSlotCreationResult = {
  slotId: string
  slotNames: Record<string, string>
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
  slotNames?: CustomMeshMaterialSlotNames,
): string[] {
  const slotIds = new Set<string>([CUSTOM_MESH_BODY_SLOT_ID])
  for (const slotId of Object.keys(slotNames ?? {})) slotIds.add(slotId)
  for (const slotId of Object.keys(slots ?? {})) slotIds.add(slotId)
  for (const face of topology.faces) slotIds.add(face.materialSlot)
  return [...slotIds]
}

export function createCustomMeshMaterialSlot(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
  slotNames: CustomMeshMaterialSlotNames,
): CustomMeshMaterialSlotCreationResult {
  const used = new Set(customMeshMaterialSlotIds(topology, slots, slotNames))
  let index = 1
  while (used.has(`slot-${index}`)) index += 1
  const slotId = `slot-${index}`
  return {
    slotId,
    slotNames: { ...slotNames, [slotId]: `Slot ${index}` },
  }
}

export function renameCustomMeshMaterialSlot(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
  slotNames: CustomMeshMaterialSlotNames,
  slotId: string,
  name: string,
): CustomMeshMaterialSlotNames {
  const nextName = name.trim()
  if (
    !nextName ||
    !customMeshMaterialSlotIds(topology, slots, slotNames).includes(slotId) ||
    slotNames?.[slotId] === nextName
  ) {
    return slotNames
  }
  return { ...slotNames, [slotId]: nextName }
}

export function setCustomMeshMaterialSlot(
  slots: CustomMeshMaterialSlots,
  slotId: string,
  materialRef: MaterialRef | undefined,
): CustomMeshMaterialSlotUpdateResult {
  if (materialRef) {
    if (slots?.[slotId] === materialRef) return { slots, changed: false }
    return { slots: { ...slots, [slotId]: materialRef }, changed: true }
  }
  if (!Object.hasOwn(slots ?? {}, slotId)) return { slots, changed: false }
  const retainedEntries = Object.entries(slots ?? {}).filter(([candidate]) => candidate !== slotId)
  return {
    slots: retainedEntries.length > 0 ? Object.fromEntries(retainedEntries) : undefined,
    changed: true,
  }
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
  slotNames?: CustomMeshMaterialSlotNames,
): CustomMeshMaterialSlotRemovalResult {
  const slotIds = customMeshMaterialSlotIds(topology, slots, slotNames)
  const fallbackSlotId = slotIds[0] ?? CUSTOM_MESH_BODY_SLOT_ID
  if (slotId === fallbackSlotId || !slotIds.includes(slotId)) {
    return { topology, slots, slotNames, fallbackSlotId, changed: false }
  }

  const remapsFaces = topology.faces.some((face) => face.materialSlot === slotId)
  const removesBinding = Object.hasOwn(slots ?? {}, slotId)
  const removesName = Object.hasOwn(slotNames ?? {}, slotId)
  if (!(remapsFaces || removesBinding || removesName)) {
    return { topology, slots, slotNames, fallbackSlotId, changed: false }
  }

  const retainedEntries = Object.entries(slots ?? {}).filter(([candidate]) => candidate !== slotId)
  const retainedNames = Object.entries(slotNames ?? {}).filter(
    ([candidate]) => candidate !== slotId,
  )
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
    slotNames: retainedNames.length > 0 ? Object.fromEntries(retainedNames) : undefined,
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

export function assignCustomMeshMaterial(
  topology: CustomMeshTopology,
  slots: CustomMeshMaterialSlots,
  selectedFaceIds: readonly string[],
  assignment: CustomMeshMaterialAssignment,
  slotNames?: CustomMeshMaterialSlotNames,
): CustomMeshMaterialAssignmentResult {
  const selected = new Set(selectedFaceIds)
  const hasSelectedFace = topology.faces.some((face) => selected.has(face.id))
  const slotId = assignment.slotId
  if (!customMeshMaterialSlotIds(topology, slots, slotNames).includes(slotId)) {
    return { topology, slots, slotId, changed: false }
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
    slots,
    slotId,
    changed: true,
  }
}
