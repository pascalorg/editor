import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveStairSurfaceMaterial,
  type PaintPreviewArgs,
  type PaintResolveArgs,
  parseMaterialRef,
  type SceneMaterial,
  type SceneMaterialId,
  type StairSegmentNode,
  type StairSlotId,
} from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import {
  buildSlotPreviewMaterial,
  createSlotPaintCapability,
  declaredSlotLook,
} from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'

function isStairSlotId(value: unknown): value is StairSlotId {
  return value === 'treads' || value === 'body' || value === 'railing' || value === 'infill'
}

function resolveStairPaintRole(args: PaintResolveArgs): StairSlotId | null {
  const userData = args.hitObject?.userData as { slotId?: unknown; slotIds?: unknown } | undefined

  if (isStairSlotId(userData?.slotId)) {
    return userData.slotId
  }

  if (Array.isArray(userData?.slotIds)) {
    const slotId = userData.slotIds[args.materialIndex ?? 0]
    return isStairSlotId(slotId) ? slotId : null
  }

  return null
}

function previewStairSlot(args: PaintPreviewArgs): (() => void) | null {
  const { role, root, material, materialPreset } = args
  const nodes = args.nodes ?? {}
  if (!isStairSlotId(role)) return null

  const preview = buildSlotPreviewMaterial(material, materialPreset, args.materials ?? {})
  if (!preview) return () => {}

  const restores: Array<() => void> = []
  ;(root as Object3D).traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return

    const userData = mesh.userData as { slotId?: unknown; slotIds?: unknown; segmentIds?: string[] }
    if (userData.slotId === role) {
      restores.push(swapPreviewMaterial(mesh, preview))
      return
    }

    if (!Array.isArray(userData.slotIds)) return
    if (!userData.slotIds.includes(role)) return
    if (!Array.isArray(mesh.material)) return

    const next = mesh.material.slice()
    let changed = false
    for (const [index, slotId] of userData.slotIds.entries()) {
      if (slotId !== role) continue
      const segmentId = userData.segmentIds?.[index]
      const segment = segmentId ? nodes[segmentId as AnyNodeId] : undefined
      if (
        args.node.type === 'stair' &&
        segment?.type === 'stair-segment' &&
        (slotLook(segment, role, args.materials ?? {}) ||
          segment.material !== undefined ||
          typeof segment.materialPreset === 'string')
      )
        continue
      next[index] = preview
      changed = true
    }
    if (!changed) return
    restores.push(swapPreviewMaterial(mesh, next))
  })

  if (restores.length === 0) return null
  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
  }
}

function slotLook(node: AnyNode, role: string, materials: Record<SceneMaterialId, SceneMaterial>) {
  const parsed = parseMaterialRef((node as { slots?: Record<string, string> }).slots?.[role])
  if (!parsed) return null
  if (parsed.kind === 'library')
    return { material: undefined, materialPreset: `library:${parsed.id}` }
  const entry = materials[parsed.id as SceneMaterialId]
  return entry ? { material: entry.material, materialPreset: undefined } : null
}

function legacyEffective(node: AnyNode, role: string) {
  if (!isStairSlotId(role) || role === 'infill') return null
  if (node.type === 'stair-segment') {
    return node.material !== undefined || typeof node.materialPreset === 'string'
      ? { material: node.material, materialPreset: node.materialPreset }
      : null
  }
  if (node.type !== 'stair') return null
  const spec = getEffectiveStairSurfaceMaterial(
    node,
    role === 'treads' ? 'tread' : role === 'body' ? 'side' : 'railing',
  )
  return spec.material !== undefined || spec.materialPreset !== undefined
    ? { material: spec.material, materialPreset: spec.materialPreset }
    : null
}

function segmentFallbackLook(
  segment: StairSegmentNode,
  role: string,
  nodes: Record<AnyNodeId, AnyNode>,
  materials: Record<SceneMaterialId, SceneMaterial>,
) {
  const own = legacyEffective(segment, role)
  if (own) return own
  const parent = segment.parentId ? nodes[segment.parentId as AnyNodeId] : undefined
  return parent?.type === 'stair'
    ? (slotLook(parent, role, materials) ??
        legacyEffective(parent, role) ??
        declaredSlotLook(parent, role))
    : declaredSlotLook(segment, role)
}

export const stairPaint = createSlotPaintCapability({
  resolveRole: resolveStairPaintRole,
  applyPreview: previewStairSlot,
  legacyEffective,
  erasedLook: ({ node, role }) => legacyEffective(node, role) ?? declaredSlotLook(node, role),
})

const segmentPaint = createSlotPaintCapability({
  resolveRole: resolveStairPaintRole,
  applyPreview: previewStairSlot,
  legacyEffective,
  erasedLook: ({ node, role, nodes, materials }) =>
    segmentFallbackLook(node as StairSegmentNode, role, nodes ?? {}, materials ?? {}),
})
export const stairSegmentPaint = {
  ...segmentPaint,
  getEffectiveMaterial: (
    args: Parameters<NonNullable<typeof segmentPaint.getEffectiveMaterial>>[0],
  ) => {
    if (args.role !== 'treads' && args.role !== 'body') return null
    const look =
      segmentPaint.getEffectiveMaterial?.(args) ??
      segmentFallbackLook(
        args.node as StairSegmentNode,
        args.role,
        args.nodes,
        args.materials ?? {},
      )
    return look ? { material: look.material, materialPreset: look.materialPreset } : null
  },
}
