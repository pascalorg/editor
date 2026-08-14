import {
  type AnyNode,
  type AnyNodeId,
  type CustomMeshNode,
  type MaterialRef,
  type PaintCapability,
  type PaintPatchArgs,
  type PaintPreviewArgs,
  type PaintResolveArgs,
  parseMaterialRef,
  type SceneMaterialId,
  useScene,
} from '@pascal-app/core'
import { type Mesh, type Object3D, Raycaster } from 'three'
import { buildSlotPreviewMaterial, resolveSlotPaintMaterialRef } from '../shared/slot-paint'
import {
  CUSTOM_MESH_BODY_SLOT_ID,
  customMeshMaterialSlotIds,
  setCustomMeshMaterialSlot,
} from './material-slots'

const customMeshPaintRaycaster = new Raycaster()

type CustomMeshFaceRange = { faceId: string; start: number; count: number }

function customMeshFaceRanges(mesh: Mesh): CustomMeshFaceRange[] {
  const ranges = mesh.geometry.userData.customMeshFaces
  return Array.isArray(ranges) ? ranges : []
}

function resolveCustomMeshPaintRole(args: PaintResolveArgs): string | null {
  const mesh = args.hitObject as Mesh | undefined
  if (!(mesh?.isMesh && args.ray)) return null
  mesh.updateWorldMatrix(true, false)
  customMeshPaintRaycaster.ray.copy(args.ray)
  const hit = customMeshPaintRaycaster.intersectObject(mesh, false)[0]
  if (hit?.faceIndex == null) return null
  const triangleStart = hit.faceIndex * 3
  const range = customMeshFaceRanges(mesh).find(
    (candidate) =>
      triangleStart >= candidate.start && triangleStart < candidate.start + candidate.count,
  )
  return range
    ? ((args.node as CustomMeshNode).topology.faces.find((face) => face.id === range.faceId)
        ?.materialSlot ?? null)
    : null
}

function paintCustomMeshSlot(
  node: CustomMeshNode,
  slotId: string,
  materialRef: MaterialRef | undefined,
) {
  if (!customMeshMaterialSlotIds(node.topology, node.slots, node.slotNames).includes(slotId)) {
    return null
  }
  return setCustomMeshMaterialSlot(node.slots, slotId, materialRef)
}

function buildCustomMeshFacePaintPatch(args: PaintPatchArgs): Partial<AnyNode> {
  const node = args.node as CustomMeshNode
  if (args.material && !args.materialPreset) return {}
  const result = paintCustomMeshSlot(node, args.role, args.materialPreset)
  return result?.changed ? { slots: result.slots } : {}
}

function commitCustomMeshFacePaint(args: PaintPatchArgs): void {
  const nodeId = args.node.id as AnyNodeId
  const state = useScene.getState()
  const current = state.nodes[nodeId]
  if (current?.type !== 'custom-mesh') return
  const resolution = resolveSlotPaintMaterialRef(
    state.materials,
    args.material,
    args.materialPreset,
  )
  if (!resolution) return
  const result = paintCustomMeshSlot(current, args.role, resolution.ref)
  if (!result?.changed) return
  let committed = false
  useScene.setState((scene) => {
    if (scene.readOnly || scene.nodes[nodeId]?.type !== 'custom-mesh') return scene
    committed = true
    return {
      materials: resolution.newSceneMaterial
        ? {
            ...scene.materials,
            [resolution.newSceneMaterial.id as SceneMaterialId]: resolution.newSceneMaterial,
          }
        : scene.materials,
      nodes: {
        ...scene.nodes,
        [nodeId]: {
          ...scene.nodes[nodeId],
          slots: result.slots,
        } as AnyNode,
      },
    }
  })
  if (committed) useScene.getState().markDirty(nodeId)
}

function previewCustomMeshFace(args: PaintPreviewArgs): (() => void) | null {
  const preview = buildSlotPreviewMaterial(args.material, args.materialPreset)
  if (!preview) return () => {}
  const node = args.node as CustomMeshNode
  const faceIds = new Set(
    node.topology.faces.filter((face) => face.materialSlot === args.role).map((face) => face.id),
  )
  if (faceIds.size === 0) return null

  const restores: Array<() => void> = []
  ;(args.root as Object3D).traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || mesh.userData.__fromGeometry !== true) return
    const ranges = customMeshFaceRanges(mesh).filter((candidate) => faceIds.has(candidate.faceId))
    if (ranges.length === 0) return
    const materialGroups = ranges.flatMap((range) =>
      mesh.geometry.groups.filter(
        (group) => group.start === range.start && group.count === range.count,
      ),
    )
    if (materialGroups.length === 0) return

    const previousMaterial = mesh.material
    const previousMaterialIndices = materialGroups.map((group) => group.materialIndex)
    const slotIds = (mesh.userData as { slotIds?: unknown }).slotIds
    const next = Array.isArray(previousMaterial)
      ? previousMaterial.slice()
      : Array.isArray(slotIds)
        ? slotIds.map(() => previousMaterial)
        : [previousMaterial]
    for (const materialGroup of materialGroups) materialGroup.materialIndex = next.length
    mesh.material = [...next, preview]
    restores.push(() => {
      materialGroups.forEach((group, index) => {
        group.materialIndex = previousMaterialIndices[index]
      })
      mesh.material = previousMaterial
    })
  })

  if (restores.length === 0) return null
  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
  }
}

export const customMeshPaint: PaintCapability = {
  resolveRole: resolveCustomMeshPaintRole,
  buildPatch: buildCustomMeshFacePaintPatch,
  commit: commitCustomMeshFacePaint,
  applyPreview: previewCustomMeshFace,
  getEffectiveMaterial: ({ node, role }) => {
    if (node.type !== 'custom-mesh') return null
    const ref = node.slots?.[role] ?? node.slots?.[CUSTOM_MESH_BODY_SLOT_ID]
    const parsed = parseMaterialRef(ref)
    if (!parsed) return null
    if (parsed.kind === 'library') return { material: undefined, materialPreset: ref }
    const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
    return sceneMaterial ? { material: sceneMaterial.material, materialPreset: undefined } : null
  },
}
