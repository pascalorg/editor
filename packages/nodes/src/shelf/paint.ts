import {
  type AnyNode,
  type AnyNodeId,
  generateSceneMaterialId,
  type MaterialSchema,
  type PaintCapability,
  parseMaterialRef,
  type SceneMaterial,
  type SceneMaterialId,
  type ShelfNode,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useViewer } from '@pascal-app/viewer'
import type { Material, Mesh } from 'three'

type ShelfSlotUserData = {
  slotId?: string | null
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

function resolveShelfSlotId(args: { hitObject?: { userData?: ShelfSlotUserData } }): string | null {
  const slotId = args.hitObject?.userData?.slotId
  return typeof slotId === 'string' ? slotId : null
}

function buildShelfSlotsPatch(
  node: ShelfNode,
  role: string,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<ShelfNode> {
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
  nextSlots: ShelfNode['slots'],
  sceneMaterial: SceneMaterial,
): void {
  // Creating the scene material and setting the slot ref are one logical
  // edit, so apply both in a single `set` — zundo records one history entry,
  // and one undo removes both the ref and its (now orphaned) material.
  useScene.setState((state) => {
    if (state.readOnly) return state
    const currentNode = state.nodes[nodeId]
    if (currentNode?.type !== 'shelf') return state
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

function commitShelfPaint(
  node: ShelfNode,
  role: string,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): void {
  const nodeId = node.id as AnyNodeId
  const state = useScene.getState()
  const currentNode = (state.nodes[nodeId] as ShelfNode | undefined) ?? node
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
  if (materialPreset) return createMaterialFromPresetRef(materialPreset, shading)
  if (material) return createMaterial(material, shading)
  return null
}

function applyShelfPreview(
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
    const userData = mesh.userData as ShelfSlotUserData & { __fromGeometry?: boolean }
    // Only the shelf's own builder meshes — never hosted item children, whose
    // GLB meshes can carry a colliding `userData.slotId` (slot_frame, etc.).
    if (userData.__fromGeometry !== true) return
    if (userData.slotId !== role) return

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

export const shelfPaint: PaintCapability = {
  resolveRole: ({ hitObject }) =>
    resolveShelfSlotId({ hitObject: hitObject as { userData?: ShelfSlotUserData } }),
  buildPatch: ({ node, role, material, materialPreset }) =>
    buildShelfSlotsPatch(node as ShelfNode, role, material, materialPreset) as Partial<AnyNode>,
  commit: ({ node, role, material, materialPreset }) =>
    commitShelfPaint(node as ShelfNode, role, material, materialPreset),
  applyPreview: ({ role, root, material, materialPreset }) =>
    applyShelfPreview(role, root, material, materialPreset),
  getEffectiveMaterial: ({ node, role }) => {
    const shelf = node as ShelfNode
    const parsed = parseMaterialRef(shelf.slots?.[role])
    if (parsed) {
      if (parsed.kind === 'library') {
        return { material: undefined, materialPreset: shelf.slots?.[role] }
      }
      const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
      if (sceneMaterial) return { material: sceneMaterial.material, materialPreset: undefined }
    }
    // No (or dangling) slot ref — surface the legacy whole-shelf paint the
    // geometry builder still falls back to, so the picker matches what renders.
    if (shelf.materialPreset || shelf.material) {
      return { material: shelf.material, materialPreset: shelf.materialPreset }
    }
    return null
  },
}
