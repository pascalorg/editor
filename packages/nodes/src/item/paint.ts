import {
  type AnyNode,
  type AnyNodeId,
  generateSceneMaterialId,
  type ItemNode,
  type MaterialSchema,
  type PaintCapability,
  parseMaterialRef,
  type SceneMaterial,
  type SceneMaterialId,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useViewer } from '@pascal-app/viewer'
import type { Material, Mesh } from 'three'

type SlotTag = string | null | (string | null)[]

type SlotUserData = {
  slotId?: SlotTag
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!deepEqual(a[index], b[index])) return false
    }
    return true
  }
  if (typeof a === 'object') {
    const aRecord = a as Record<string, unknown>
    const bRecord = b as Record<string, unknown>
    const aKeys = Object.keys(aRecord)
    const bKeys = Object.keys(bRecord)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!Object.hasOwn(bRecord, key)) return false
      if (!deepEqual(aRecord[key], bRecord[key])) return false
    }
    return true
  }
  return false
}

function getSlotTag(mesh: Mesh): SlotTag | undefined {
  return (mesh.userData as SlotUserData).slotId
}

function slotTagContainsRole(tag: SlotTag | undefined, role: string): boolean {
  if (Array.isArray(tag)) return tag.includes(role)
  return tag === role
}

function resolveItemSlotId(args: {
  materialIndex: number | null
  hitObject?: { userData?: SlotUserData }
}): string | null {
  const tag = args.hitObject?.userData?.slotId
  const slotId = Array.isArray(tag)
    ? (tag[args.materialIndex ?? 0] ?? null)
    : typeof tag === 'string'
      ? tag
      : null
  return slotId
}

function buildItemSlotsPatch(
  node: ItemNode,
  role: string,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<ItemNode> {
  const slots = { ...(node.slots ?? {}) }
  if (material === undefined && materialPreset === undefined) {
    delete slots[role]
    return { slots }
  }
  if (materialPreset) {
    slots[role] = materialPreset
    return { slots }
  }
  return { slots }
}

function findMatchingSceneMaterial(
  materials: Record<SceneMaterialId, SceneMaterial>,
  material: MaterialSchema,
): SceneMaterial | null {
  for (const sceneMaterial of Object.values(materials)) {
    if (deepEqual(sceneMaterial.material, material)) return sceneMaterial
  }
  return null
}

function commitNewSceneMaterialAndSlots(
  nodeId: AnyNodeId,
  nextSlots: ItemNode['slots'],
  sceneMaterial: SceneMaterial,
): void {
  // Creating the scene material and setting the slot ref are one logical
  // edit, so apply both in a single `set` — zundo records one history entry,
  // and one undo removes both the ref and its (now orphaned) material.
  useScene.setState((state) => {
    if (state.readOnly) return state
    const currentNode = state.nodes[nodeId]
    if (currentNode?.type !== 'item') return state
    return {
      materials: { ...state.materials, [sceneMaterial.id as SceneMaterialId]: sceneMaterial },
      nodes: {
        ...state.nodes,
        [nodeId]: { ...currentNode, slots: nextSlots } as AnyNode,
      },
    }
  })
  useScene.getState().markDirty(nodeId)
}

function commitItemPaint(
  node: ItemNode,
  role: string,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): void {
  const nodeId = node.id as AnyNodeId
  const state = useScene.getState()
  const currentNode = (state.nodes[nodeId] as ItemNode | undefined) ?? node
  let ref: string | undefined
  let newSceneMaterial: SceneMaterial | null = null

  if (material === undefined && materialPreset === undefined) {
    ref = undefined
  } else if (materialPreset) {
    ref = materialPreset
  } else if (material) {
    const existing = findMatchingSceneMaterial(state.materials, material)
    if (existing) {
      ref = toSceneMaterialRef(existing.id)
    } else {
      const id = generateSceneMaterialId()
      newSceneMaterial = {
        id,
        name: `Material ${Object.keys(state.materials).length + 1}`,
        material,
      }
      ref = toSceneMaterialRef(id)
    }
  } else {
    return
  }

  const nextSlots = { ...(currentNode.slots ?? {}) }
  if (ref) nextSlots[role] = ref
  else delete nextSlots[role]

  if (newSceneMaterial) {
    commitNewSceneMaterialAndSlots(nodeId, nextSlots, newSceneMaterial)
    return
  }

  state.updateNode(nodeId, { slots: nextSlots } as Partial<AnyNode>)
}

function buildPreviewMaterial(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Material | null {
  const shading = useViewer.getState().shading
  if (materialPreset) {
    const parsed = parseMaterialRef(materialPreset)
    if (parsed?.kind === 'scene') {
      const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
      return sceneMaterial ? createMaterial(sceneMaterial.material, shading) : null
    }
    return createMaterialFromPresetRef(materialPreset, shading)
  }
  if (material) return createMaterial(material, shading)
  return null
}

function applyItemPreview(
  role: string,
  root: import('three').Object3D,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): (() => void) | null {
  const previewMaterial = buildPreviewMaterial(material, materialPreset)
  if (!previewMaterial) return () => {}

  const restores: Array<() => void> = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const tag = getSlotTag(mesh)
    if (!slotTagContainsRole(tag, role)) return

    if (Array.isArray(tag)) {
      const current = mesh.material as Material | Material[]
      if (Array.isArray(current)) {
        const previousArray = [...current]
        const nextArray = [...current]
        let changed = false
        for (let index = 0; index < tag.length; index += 1) {
          if (tag[index] !== role || !nextArray[index]) continue
          nextArray[index] = previewMaterial
          changed = true
        }
        if (!changed) return
        mesh.material = nextArray
        restores.push(() => {
          mesh.material = previousArray
        })
        return
      }
      if (tag[0] !== role) return
    }

    const previous = mesh.material
    mesh.material = previewMaterial
    restores.push(() => {
      mesh.material = previous
    })
  })

  if (restores.length === 0) return null
  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) {
      restores[index]?.()
    }
  }
}

export const itemPaint: PaintCapability = {
  resolveRole: ({ materialIndex, hitObject }) =>
    resolveItemSlotId({ materialIndex, hitObject: hitObject as { userData?: SlotUserData } }),
  buildPatch: ({ node, role, material, materialPreset }) =>
    buildItemSlotsPatch(node as ItemNode, role, material, materialPreset) as Partial<AnyNode>,
  commit: ({ node, role, material, materialPreset }) =>
    commitItemPaint(node as ItemNode, role, material, materialPreset),
  applyPreview: ({ role, root, material, materialPreset }) =>
    applyItemPreview(role, root, material, materialPreset),
  getEffectiveMaterial: ({ node, role }) => {
    const ref = (node as ItemNode).slots?.[role]
    const parsed = parseMaterialRef(ref)
    if (!parsed) return null
    if (parsed.kind === 'library') {
      return { material: undefined, materialPreset: ref }
    }
    const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
    if (!sceneMaterial) return null
    return { material: sceneMaterial.material, materialPreset: undefined }
  },
}
