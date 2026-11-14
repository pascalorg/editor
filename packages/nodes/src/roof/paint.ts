import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveSegmentSurfaceMaterial,
  getRoofWallBandMaterial,
  type PaintCapability,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSurfaceMaterialRole,
  useScene,
} from '@pascal-app/core'
import { buildRoofSurfaceMaterialPatch, resolveRoofWallHit } from '@pascal-app/editor'
import {
  getRoofMaterialArray,
  levelWallCladdingRef,
  levelWallFaceRef,
  ROOF_HEEL_MATERIAL_INDEX,
  useViewer,
} from '@pascal-app/viewer'
import { type Mesh, Vector3 } from 'three'
import { wallBandPatch } from '../roof-segment/paint'
import { swapPreviewMaterial } from '../shared/swap-preview-material'

type RoofGableBand = 'gable-left' | 'gable-right'

/** Every gable of the roof: the `matching` scope of a gable hit. */
export const ROOF_ALL_GABLES_ROLE = 'gables:all'

/** One gable of the merged shell: `gable-left:<segmentId>` / `gable-right:<segmentId>`. */
export function roofGableRole(band: RoofGableBand, segmentId: string): string {
  return `${band}:${segmentId}`
}

export function parseRoofGableRole(
  role: string,
): { band: RoofGableBand; segmentId: AnyNodeId } | null {
  const split = role.indexOf(':')
  if (split < 0) return null
  const band = role.slice(0, split)
  if (band !== 'gable-left' && band !== 'gable-right') return null
  return { band, segmentId: role.slice(split + 1) as AnyNodeId }
}

const isSurfaceRole = (role: string): role is RoofSurfaceMaterialRole =>
  role === 'top' || role === 'edge' || role === 'wall'

const hitWorldPoint = new Vector3()

/** The merged shell's surface under the cursor: its material slot, else the hit normal. */
function surfaceRole(
  materialIndex: number | null,
  normal: readonly [number, number, number] | undefined,
): RoofSurfaceMaterialRole | 'heel' | null {
  if (materialIndex === 3) return 'top'
  if (materialIndex === ROOF_HEEL_MATERIAL_INDEX) return 'heel'
  if (materialIndex === 0) return 'edge'
  if (materialIndex === 1 || materialIndex === 2) return 'wall'

  const normalY = normal?.[1]
  if (normalY !== undefined && normalY > 0.35) return 'top'
  if (normalY !== undefined && Math.abs(normalY) <= 0.35) return 'edge'
  if (normalY !== undefined && normalY < -0.35) return 'wall'
  return null
}

/** The merged roof with `role` repainted, so the preview draws it the way a commit would. */
function previewRoof(
  roof: RoofNode,
  role: string,
  material: RoofNode['material'],
  preset?: string,
) {
  if (role === 'heel') return { ...roof, ...wallBandPatch('heel', material, preset) } as RoofNode
  const surface = role === ROOF_ALL_GABLES_ROLE ? 'edge' : role
  if (!isSurfaceRole(surface)) return null
  return { ...roof, ...buildRoofSurfaceMaterialPatch(roof, surface, material, preset) }
}

/**
 * The merged roof shell's paint. Its surfaces are the roof's top / edge / wall
 * finishes and the heel band; an edge hit on a segment's ±x end wall is that
 * gable alone (its segment's gable finish), and the `matching` scope widens it
 * to every gable — the roof's edge, with no segment keeping a gable of its own.
 */
export const roofPaint: PaintCapability = {
  materialTarget: 'roof',
  resolveRole(args) {
    const role = surfaceRole(args.materialIndex, args.normal)
    if (role !== 'edge' || !(args.localPosition && args.hitObject)) return role
    args.hitObject.updateWorldMatrix(true, false)
    const position = args.hitObject.localToWorld(hitWorldPoint.set(...args.localPosition))
    const hit = resolveRoofWallHit(
      args.node as RoofNode,
      [position.x, position.y, position.z],
      args.normal as [number, number, number] | undefined,
      args.hitObject,
    )
    if (!hit || (hit.face.id !== 'left' && hit.face.id !== 'right')) return role
    return roofGableRole(hit.face.id === 'left' ? 'gable-left' : 'gable-right', hit.segment.id)
  },
  roleLabel(_node, role) {
    if (role === 'heel') return 'Heel band'
    if (role === ROOF_ALL_GABLES_ROLE) return 'All gables'
    const gable = parseRoofGableRole(role)
    if (!gable) return null
    return gable.band === 'gable-left' ? 'Left gable' : 'Right gable'
  },
  scopes(_node, role) {
    if (!parseRoofGableRole(role)) return null
    return {
      scopes: ['single', 'matching'],
      labels: { matching: 'All gables' },
      roleFor: (scope) => (scope === 'matching' ? ROOF_ALL_GABLES_ROLE : role),
    }
  },
  buildPatch({ node, role, material, materialPreset }) {
    const roof = node as RoofNode
    if (role === 'heel') return wallBandPatch('heel', material, materialPreset) as Partial<AnyNode>
    if (role === ROOF_ALL_GABLES_ROLE)
      return buildRoofSurfaceMaterialPatch(roof, 'edge', material, materialPreset)
    if (!isSurfaceRole(role)) return {}
    return buildRoofSurfaceMaterialPatch(roof, role, material, materialPreset)
  },
  commit(args) {
    const scene = useScene.getState()
    const gable = parseRoofGableRole(args.role)
    if (gable) {
      scene.updateNode(
        gable.segmentId,
        wallBandPatch(gable.band, args.material, args.materialPreset),
      )
      return
    }
    if (args.role !== ROOF_ALL_GABLES_ROLE) {
      scene.updateNode(args.node.id as AnyNodeId, roofPaint.buildPatch(args))
      return
    }
    // Every gable: the roof's edge, and no segment keeping a gable of its own.
    const cleared: Partial<RoofSegmentNode> = {
      ...wallBandPatch('gable-left', undefined, undefined),
      ...wallBandPatch('gable-right', undefined, undefined),
    }
    scene.updateNodes([
      { id: args.node.id as AnyNodeId, data: roofPaint.buildPatch(args) },
      ...((args.node as RoofNode).children ?? []).flatMap((childId) =>
        scene.nodes[childId as AnyNodeId]?.type === 'roof-segment'
          ? [{ id: childId as AnyNodeId, data: cleared as Partial<AnyNode> }]
          : [],
      ),
    ])
  },
  applyPreview(args) {
    // One gable has no surface of its own on the merged shell until it is painted.
    if (parseRoofGableRole(args.role)) return null
    const mesh = args.root.getObjectByName('merged-roof') as Mesh | undefined
    if (!mesh) return null
    const roof = args.node as RoofNode
    const preview = previewRoof(roof, args.role, args.material, args.materialPreset)
    if (!preview) return null
    // The renderer's wall-derived defaults, so the surfaces not being painted hold still.
    const nodes = args.nodes ?? useScene.getState().nodes
    const viewer = useViewer.getState()
    const material = getRoofMaterialArray(
      preview,
      viewer.shading,
      viewer.textures,
      viewer.colorPreset,
      viewer.sceneTheme,
      levelWallCladdingRef(nodes, roof),
      args.materials ?? useScene.getState().materials,
      levelWallFaceRef(nodes, roof),
    )
    return material ? swapPreviewMaterial(mesh, material) : null
  },
  // The top / edge / wall finishes return null here and resolve through the
  // editor's roof surface fallback (`resolveActivePaintMaterialFromSelection`).
  getEffectiveMaterial({ node, role, nodes }) {
    if (role === 'heel') {
      const own = getRoofWallBandMaterial(node as RoofNode, 'heel')
      return own ? { material: own.material, materialPreset: own.materialPreset } : null
    }
    const gable = parseRoofGableRole(role)
    const segment = gable ? (nodes?.[gable.segmentId] as RoofSegmentNode | undefined) : undefined
    if (!(gable && segment?.type === 'roof-segment')) return null
    // Unpainted, a gable shows the segment's edge, falling back to the roof's.
    const own = getRoofWallBandMaterial(segment, gable.band)
    if (own) return { material: own.material, materialPreset: own.materialPreset }
    const edge = getEffectiveSegmentSurfaceMaterial(
      segment,
      'edge',
      getEffectiveRoofSurfaceMaterial(node as RoofNode, 'edge'),
    )
    return { material: edge.material, materialPreset: edge.materialPreset }
  },
}
