import {
  type AnyNode,
  type AnyNodeId,
  generateSceneMaterialId,
  type MaterialSchema,
  type PaintCapability,
  type PaintPreviewArgs,
  type PaintResolveArgs,
  parseMaterialRef,
  type SceneMaterial,
  type SceneMaterialId,
  sceneRegistry,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useViewer } from '@pascal-app/viewer'
import { type Material, type Mesh, type Object3D, Raycaster } from 'three'

/**
 * Shared paint capability for procedural kinds on the unified slot model
 * (`node.slots: Record<slotId, MaterialRef>` + the shared scene-material
 * palette) — the same data shape items derive from their GLB and the shelf
 * declares via `capabilities.slots`. Distinct from `surface-paint.ts`, which
 * writes the legacy inline `node.material` copy the plan is retiring.
 *
 * The commit / resolve / effective-material logic is identical across kinds;
 * only the slot-resolution from a pointer hit and the mesh preview differ, so
 * those are injected per kind.
 */

type SlotsNode = AnyNode & { slots?: Record<string, string> }

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

function findMatchingSceneMaterial(
  materials: Record<SceneMaterialId, SceneMaterial>,
  material: MaterialSchema,
): SceneMaterial | null {
  for (const sceneMaterial of Object.values(materials)) {
    if (deepEqual(sceneMaterial.material, material)) return sceneMaterial
  }
  return null
}

function commitSlotPaint(
  node: SlotsNode,
  role: string,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): void {
  const nodeId = node.id as AnyNodeId
  const state = useScene.getState()
  const currentNode = (state.nodes[nodeId] as SlotsNode | undefined) ?? node

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
    // Creating the scene material and setting the slot ref are one logical
    // edit, so apply both in a single `set` — zundo records one history entry,
    // and one undo removes both the ref and its (now orphaned) material.
    const sceneMaterial = newSceneMaterial
    useScene.setState((s) => {
      if (s.readOnly) return s
      const node2 = s.nodes[nodeId] as SlotsNode | undefined
      if (!node2) return s
      return {
        materials: { ...s.materials, [sceneMaterial.id as SceneMaterialId]: sceneMaterial },
        nodes: {
          ...s.nodes,
          [nodeId]: { ...node2, slots: nextSlots } as AnyNode,
        },
      }
    })
    useScene.getState().markDirty(nodeId)
    return
  }

  state.updateNode(nodeId, { slots: nextSlots } as Partial<AnyNode>)
}

/** Preview material for a slot paint — mirrors the commit's resolution. */
export function buildSlotPreviewMaterial(
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

/**
 * Preview for kinds whose meshes are produced by `def.geometry` and tagged
 * with `userData.slotId` (+ `__fromGeometry`). Swaps every builder mesh whose
 * slot matches `role`, leaving hosted-child meshes (which can carry a colliding
 * `userData.slotId` from their own GLB) untouched.
 */
export function previewGeometrySlot(args: PaintPreviewArgs): (() => void) | null {
  const { role, root, material, materialPreset } = args
  const preview = buildSlotPreviewMaterial(material, materialPreset)
  if (!preview) return () => {}

  const restores: Array<() => void> = []
  ;(root as Object3D).traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const userData = mesh.userData as { slotId?: string | null; __fromGeometry?: boolean }
    if (userData.__fromGeometry !== true) return
    if (userData.slotId !== role) return
    const previous = mesh.material
    mesh.material = preview
    restores.push(() => {
      mesh.material = previous
    })
  })

  if (restores.length === 0) return null
  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
  }
}

/**
 * Preview for kinds whose meshes are built by a viewer system (window, door)
 * and tagged with `userData.slotId` — no `__fromGeometry` marker and no hosted
 * children to guard against, so it swaps every mesh whose slot matches `role`.
 */
export function previewSlotByUserData(args: PaintPreviewArgs): (() => void) | null {
  const { role, root, material, materialPreset } = args
  const preview = buildSlotPreviewMaterial(material, materialPreset)
  if (!preview) return () => {}

  const restores: Array<() => void> = []
  ;(root as Object3D).traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    if ((mesh.userData as { slotId?: string | null }).slotId !== role) return
    const previous = mesh.material
    mesh.material = preview
    restores.push(() => {
      mesh.material = previous
    })
  })

  if (restores.length === 0) return null
  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
  }
}

// Reused across calls — set from the pointer ray each time.
const subtreeRaycaster = new Raycaster()

/**
 * Resolve the slot for a kind whose paint hit lands on a proud opening proxy
 * (door/window: a 1m-deep invisible cutout that wins the scene raycast over the
 * wall in front of the recessed body) rather than the part itself. Re-raycasts
 * the kind's OWN registered subtree (ignoring everything else) and returns the
 * first tagged sub-mesh under the cursor; falls back to the direct hit's slot
 * (e.g. a proud part the scene raycast hit directly).
 */
export function resolveSlotByReRaycast(args: PaintResolveArgs): string | null {
  const direct = (args.hitObject?.userData as { slotId?: string } | undefined)?.slotId
  if (typeof direct === 'string') return direct
  const root = sceneRegistry.nodes.get(args.node.id as AnyNodeId)
  if (!root || !args.ray) return null
  subtreeRaycaster.ray.copy(args.ray)
  for (const hit of subtreeRaycaster.intersectObject(root, true)) {
    const slot = (hit.object.userData as { slotId?: string }).slotId
    if (typeof slot === 'string') return slot
  }
  return null
}

export type SlotPaintConfig = {
  /** Resolve the slot id for a pointer hit (`null` = not paintable here). */
  resolveRole: (args: PaintResolveArgs) => string | null
  /** Apply a preview to the registered mesh subtree for `role`. */
  applyPreview: (args: PaintPreviewArgs) => (() => void) | null
  /**
   * Optional legacy fallback for the picker's current-value indicator — read
   * when no `node.slots[role]` ref exists yet (e.g. a scene painted before the
   * kind moved onto the slot model still carries inline `material`/`preset`).
   */
  legacyEffective?: (
    node: AnyNode,
    role: string,
  ) => { material: MaterialSchema | undefined; materialPreset: string | undefined } | null
  /** Opt into the painter's `room` application scope (walls, slabs). */
  roomScope?: boolean
}

export function createSlotPaintCapability(config: SlotPaintConfig): PaintCapability {
  return {
    roomScope: config.roomScope,
    resolveRole: config.resolveRole,
    buildPatch: ({ node, role, materialPreset }) => {
      const slots = { ...((node as SlotsNode).slots ?? {}) }
      if (materialPreset) slots[role] = materialPreset
      else delete slots[role]
      return { slots } as Partial<AnyNode>
    },
    commit: ({ node, role, material, materialPreset }) =>
      commitSlotPaint(node as SlotsNode, role, material, materialPreset),
    applyPreview: config.applyPreview,
    getEffectiveMaterial: ({ node, role }) => {
      const ref = (node as SlotsNode).slots?.[role]
      const parsed = parseMaterialRef(ref)
      if (parsed) {
        if (parsed.kind === 'library') return { material: undefined, materialPreset: ref }
        const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
        if (sceneMaterial) return { material: sceneMaterial.material, materialPreset: undefined }
      }
      return config.legacyEffective?.(node, role) ?? null
    },
  }
}
