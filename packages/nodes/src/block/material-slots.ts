import type { BlockTopology, MaterialRef } from '@pascal-app/core'

export const BLOCK_BODY_SLOT_ID = 'body'

export type BlockMaterialSlots = Record<string, MaterialRef> | undefined
export type BlockMaterialSlotNames = Record<string, string> | undefined

export type BlockMaterialSelection =
  | { kind: 'empty'; activeSlotId: null }
  | { kind: 'single'; activeSlotId: string; slotId: string }
  | { kind: 'mixed'; activeSlotId: string | null }

export type BlockMaterialAssignment = { kind: 'slot'; slotId: string }

export type BlockMaterialAssignmentResult = {
  topology: BlockTopology
  slots: BlockMaterialSlots
  slotId: string
  changed: boolean
}

export type BlockMaterialSlotRemovalResult = {
  topology: BlockTopology
  slots: BlockMaterialSlots
  slotNames: BlockMaterialSlotNames
  fallbackSlotId: string
  changed: boolean
}

export type BlockMaterialSlotUpdateResult = {
  slots: BlockMaterialSlots
  changed: boolean
}

export type BlockMaterialSlotCreationResult = {
  slotId: string
  slotNames: Record<string, string>
}

export type BlockAssignedMaterialSlotCreationResult =
  | (BlockMaterialSlotCreationResult & {
      topology: BlockTopology
      slots: BlockMaterialSlots
      changed: true
    })
  | {
      topology: BlockTopology
      slots: BlockMaterialSlots
      slotId: null
      slotNames: BlockMaterialSlotNames
      changed: false
    }

export function blockMaterialSlotIds(
  topology: BlockTopology,
  slots: BlockMaterialSlots,
  slotNames?: BlockMaterialSlotNames,
): string[] {
  const slotIds = new Set<string>([BLOCK_BODY_SLOT_ID])
  for (const slotId of Object.keys(slotNames ?? {})) slotIds.add(slotId)
  for (const slotId of Object.keys(slots ?? {})) slotIds.add(slotId)
  for (const face of topology.faces) slotIds.add(face.materialSlot)
  return [...slotIds]
}

export function unpaintedBlockMaterialSlotIds(
  topology: BlockTopology,
  slots: BlockMaterialSlots,
  slotNames?: BlockMaterialSlotNames,
): string[] {
  return blockMaterialSlotIds(topology, slots, slotNames).filter(
    (slotId) => slotId !== BLOCK_BODY_SLOT_ID && !slots?.[slotId],
  )
}

export function createBlockMaterialSlot(
  topology: BlockTopology,
  slots: BlockMaterialSlots,
  slotNames: BlockMaterialSlotNames,
): BlockMaterialSlotCreationResult {
  const used = new Set(blockMaterialSlotIds(topology, slots, slotNames))
  let index = 1
  while (used.has(`slot-${index}`)) index += 1
  const slotId = `slot-${index}`
  return {
    slotId,
    slotNames: { ...slotNames, [slotId]: `Slot ${index}` },
  }
}

export function createAssignedBlockMaterialSlot(
  topology: BlockTopology,
  slots: BlockMaterialSlots,
  slotNames: BlockMaterialSlotNames,
  selectedFaceIds: readonly string[],
  materialRef: MaterialRef,
): BlockAssignedMaterialSlotCreationResult {
  const selected = new Set(selectedFaceIds)
  if (!topology.faces.some((face) => selected.has(face.id))) {
    return { topology, slots, slotId: null, slotNames, changed: false }
  }
  const created = createBlockMaterialSlot(topology, slots, slotNames)
  const assigned = assignBlockMaterial(
    topology,
    slots,
    selectedFaceIds,
    { kind: 'slot', slotId: created.slotId },
    created.slotNames,
  )
  const bound = setBlockMaterialSlot(assigned.slots, created.slotId, materialRef)
  return {
    topology: assigned.topology,
    slots: bound.slots,
    slotId: created.slotId,
    slotNames: created.slotNames,
    changed: true,
  }
}

export function renameBlockMaterialSlot(
  topology: BlockTopology,
  slots: BlockMaterialSlots,
  slotNames: BlockMaterialSlotNames,
  slotId: string,
  name: string,
): BlockMaterialSlotNames {
  const nextName = name.trim()
  if (
    !nextName ||
    !blockMaterialSlotIds(topology, slots, slotNames).includes(slotId) ||
    slotNames?.[slotId] === nextName
  ) {
    return slotNames
  }
  return { ...slotNames, [slotId]: nextName }
}

export function setBlockMaterialSlot(
  slots: BlockMaterialSlots,
  slotId: string,
  materialRef: MaterialRef | undefined,
): BlockMaterialSlotUpdateResult {
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

export function blockMaterialSelection(
  topology: BlockTopology,
  selectedFaceIds: readonly string[],
  activeFaceId: string | null,
): BlockMaterialSelection {
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

export function removeBlockMaterialSlot(
  topology: BlockTopology,
  slots: BlockMaterialSlots,
  slotId: string,
  slotNames?: BlockMaterialSlotNames,
): BlockMaterialSlotRemovalResult {
  const slotIds = blockMaterialSlotIds(topology, slots, slotNames)
  const fallbackSlotId = slotIds[0] ?? BLOCK_BODY_SLOT_ID
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

export function assignBlockMaterial(
  topology: BlockTopology,
  slots: BlockMaterialSlots,
  selectedFaceIds: readonly string[],
  assignment: BlockMaterialAssignment,
  slotNames?: BlockMaterialSlotNames,
): BlockMaterialAssignmentResult {
  const selected = new Set(selectedFaceIds)
  const hasSelectedFace = topology.faces.some((face) => selected.has(face.id))
  const slotId = assignment.slotId
  if (!blockMaterialSlotIds(topology, slots, slotNames).includes(slotId)) {
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
