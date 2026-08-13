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
import { assignCustomMeshMaterial, CUSTOM_MESH_BODY_SLOT_ID } from './material-slots'

const CUSTOM_MESH_FACE_PAINT_PREFIX = 'face_'
const customMeshPaintRaycaster = new Raycaster()

type CustomMeshFaceRange = { faceId: string; start: number; count: number }

function paintRoleForFace(faceId: string): string {
  return `${CUSTOM_MESH_FACE_PAINT_PREFIX}${faceId}`
}

function faceIdFromPaintRole(role: string): string | null {
  if (!role.startsWith(CUSTOM_MESH_FACE_PAINT_PREFIX)) return null
  return role.slice(CUSTOM_MESH_FACE_PAINT_PREFIX.length) || null
}

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
  return range ? paintRoleForFace(range.faceId) : null
}

function assignPaintedFace(
  node: CustomMeshNode,
  role: string,
  materialRef: MaterialRef | undefined,
) {
  const faceId = faceIdFromPaintRole(role)
  if (!faceId) return null
  return assignCustomMeshMaterial(
    node.topology,
    node.slots,
    [faceId],
    materialRef
      ? { kind: 'material', materialRef }
      : { kind: 'slot', slotId: CUSTOM_MESH_BODY_SLOT_ID },
  )
}

function buildCustomMeshFacePaintPatch(args: PaintPatchArgs): Partial<AnyNode> {
  const node = args.node as CustomMeshNode
  if (args.material && !args.materialPreset) return {}
  const result = assignPaintedFace(node, args.role, args.materialPreset)
  return result?.changed ? { topology: result.topology, slots: result.slots } : {}
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
  const result = assignPaintedFace(current, args.role, resolution.ref)
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
          topology: result.topology,
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
  const faceId = faceIdFromPaintRole(args.role)
  if (!faceId) return null

  const restores: Array<() => void> = []
  ;(args.root as Object3D).traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || mesh.userData.__fromGeometry !== true) return
    const range = customMeshFaceRanges(mesh).find((candidate) => candidate.faceId === faceId)
    if (!range) return
    const materialGroup = mesh.geometry.groups.find(
      (group) => group.start === range.start && group.count === range.count,
    )
    if (!materialGroup) return

    const previousMaterial = mesh.material
    const previousMaterialIndex = materialGroup.materialIndex
    const slotIds = (mesh.userData as { slotIds?: unknown }).slotIds
    const next = Array.isArray(previousMaterial)
      ? previousMaterial.slice()
      : Array.isArray(slotIds)
        ? slotIds.map(() => previousMaterial)
        : [previousMaterial]
    materialGroup.materialIndex = next.length
    mesh.material = [...next, preview]
    restores.push(() => {
      materialGroup.materialIndex = previousMaterialIndex
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
    const faceId = faceIdFromPaintRole(role)
    const slotId = faceId
      ? node.topology.faces.find((face) => face.id === faceId)?.materialSlot
      : null
    const ref = slotId ? node.slots?.[slotId] : undefined
    const parsed = parseMaterialRef(ref)
    if (!parsed) return null
    if (parsed.kind === 'library') return { material: undefined, materialPreset: ref }
    const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
    return sceneMaterial ? { material: sceneMaterial.material, materialPreset: undefined } : null
  },
}
