import {
  type AnyNode,
  buildWallFinishLayout,
  getWallLevelZones,
  resolveWallFaceChain,
  resolveWallFeaturePlacement,
  resolveWallFinish,
  sceneRegistry,
  slotPaintMaterial,
  supportSegmentAt,
  useScene,
  type WallFeatureNode,
  wallSupportForNodes,
} from '@pascal-app/core'
import { getWallBodyFaceAssignments, getWallFinishRefs } from '@pascal-app/viewer'
import type { Material, Mesh } from 'three'
import { buildSlotPreviewMaterial, createSlotPaintCapability } from '../shared/slot-paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'

function featureFinishSource(
  node: AnyNode | undefined,
  nodes: Readonly<Record<string, AnyNode>>,
  omit?: string,
): WallFeatureNode | null {
  const seen = new Set<string>()
  while (node?.type === 'wall-feature' && !seen.has(node.id)) {
    seen.add(node.id)
    if (node.id !== omit && node.slots?.surface) return node
    node = node.parentId ? nodes[node.parentId] : undefined
  }
  return null
}

export const wallFeaturePaint = createSlotPaintCapability({
  resolveRole: ({ node }) => (node.type === 'wall-feature' ? 'surface' : null),
  erasedLook: () => null,
  applyPreview(args) {
    if (args.node.type !== 'wall-feature') return null
    const nodes: Readonly<Record<string, AnyNode>> = args.nodes ?? useScene.getState().nodes
    const p = resolveWallFeaturePlacement(nodes, args.node)
    const mesh = sceneRegistry.nodes.get(p.wall.id) as Mesh | undefined
    if (!mesh?.isMesh || !Array.isArray(mesh.material)) return null
    const geometry = mesh.geometry
    const assignments = new Map(
      getWallBodyFaceAssignments(geometry).map((face) => [face.start, face]),
    )
    const erasing = args.material === undefined && args.materialPreset === undefined
    const materials = (mesh.material as Material[]).slice()
    const refs = getWallFinishRefs(geometry)
    const look = slotPaintMaterial(
      args.materialPreset,
      args.materials ?? useScene.getState().materials,
    )
    const paint = erasing
      ? null
      : buildSlotPreviewMaterial(
          args.material ?? look?.material,
          look ? look.materialPreset : args.materialPreset,
        )
    if (!erasing && !paint) return null
    if (paint) materials.push(paint)
    const indices = new Map<string, number>()
    const indexFor = (ref: string | undefined, fallback: number) => {
      if (!ref) return fallback
      const existing = refs.indexOf(ref)
      if (existing >= 0) return 3 + existing
      if (indices.has(ref)) return indices.get(ref)!
      const material = buildSlotPreviewMaterial(undefined, ref)
      if (!material) return fallback
      materials.push(material)
      indices.set(ref, materials.length - 1)
      return materials.length - 1
    }
    const groups = geometry.groups.map((group) => ({ ...group }))
    const next: typeof groups = []
    let touched = false
    for (const group of groups)
      for (let at = group.start; at < group.start + group.count; at += 3) {
        const face = assignments.get(at)
        let own = group.materialIndex ?? 0
        if (face?.ownerId) {
          let owner = nodes[face.ownerId]
          const seen = new Set<string>()
          while (owner?.type === 'wall-feature' && !seen.has(owner.id)) {
            seen.add(owner.id)
            if (owner.id === args.node.id) {
              touched = true
              const inherited = featureFinishSource(nodes[face.ownerId], nodes, args.node.id)?.slots
                ?.surface
              own = erasing ? indexFor(inherited, face.baseMaterialIndex) : materials.length - 1
              break
            }
            if (owner.slots?.surface) break
            owner = owner.parentId ? nodes[owner.parentId] : undefined
          }
        }
        const previous = next.at(-1)
        if (previous && previous.materialIndex === own && previous.start + previous.count === at)
          previous.count += 3
        else next.push({ start: at, count: 3, materialIndex: own })
      }
    if (!touched) return null
    geometry.groups = next
    const token = {}
    mesh.userData.pascalMaterialPreview = token
    const release = () => {
      if (mesh.userData.pascalMaterialPreview === token) delete mesh.userData.pascalMaterialPreview
    }
    const restore = swapPreviewMaterial(mesh, materials)
    const finish = () => {
      release()
      restore()
      if (mesh.geometry === geometry) geometry.groups = groups
    }
    return Object.assign(finish, { commit: release })
  },
})

wallFeaturePaint.getEffectiveMaterial = (args) => {
  if (args.node.type !== 'wall-feature') return null
  const p = resolveWallFeaturePlacement(args.nodes, args.node)
  const ref = featureFinishSource(args.node, args.nodes)?.slots?.surface
  if (ref) return slotPaintMaterial(ref, args.materials ?? {})
  const layout = buildWallFinishLayout(p.wall, getWallLevelZones(p.wall, args.nodes))
  const support = wallSupportForNodes(p.wall, args.nodes)
  const run = support.faceDatum[p.face].find(
    (run) => p.u / layout.length >= run.start && p.u / layout.length <= run.end,
  )
  const base = run ? supportSegmentAt(run, p.u / layout.length) : support.elevation
  const hit = resolveWallFinish(layout, p.face, p.u, p.bottom - base + args.node.height / 2)
  if (hit.source !== 'slot') return slotPaintMaterial(hit.ref, args.materials ?? {})
  const chain = resolveWallFaceChain(p.wall, p.face)
  return chain.kind === 'legacy'
    ? { material: chain.spec.material, materialPreset: chain.spec.materialPreset }
    : slotPaintMaterial(chain.ref, args.materials ?? {})
}
