import {
  type AnyNode,
  type FloorplanAffordance,
  type FloorplanMoveTarget,
  getWallFaceOffsets,
  isCurvedWall,
  planWallFeaturePlacement,
  resolveWallFeaturePlacement,
  supportSegmentAt,
  useLiveNodeOverrides,
  useScene,
  type WallFeatureNode,
  wallSupportForNodes,
} from '@pascal-app/core'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  useEditor,
  useInteractionScope,
  usePlacementPreview,
} from '@pascal-app/editor'
import {
  createWallFeaturePlacementSession,
  type WallFeatureHit,
  type WallFeatureSnap,
} from './placement'
import { clearWallFeatureEditPreview, showWallFeatureEditPreview } from './preview'
import { deferWallFeatureGeometry } from './runtime'

export function wallFeaturePlanHit(
  nodes: Readonly<Record<string, AnyNode>>,
  node: WallFeatureNode,
  point: readonly [number, number],
  levelId?: string | null,
  preferredHost?: string | null,
): WallFeatureHit | null {
  let best: WallFeatureHit | null = null,
    distance = Infinity
  for (const wall of Object.values(nodes)) {
    if (
      wall.type !== 'wall' ||
      wall.visible === false ||
      wall.wallType === 'curtain' ||
      isCurvedWall(wall) ||
      (levelId && wall.parentId !== levelId)
    )
      continue
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1],
      length = Math.hypot(dx, dz)
    if (!length) continue
    const x = point[0] - wall.start[0],
      z = point[1] - wall.start[1]
    const u = (x * dx + z * dz) / length,
      n = (-x * dz + z * dx) / length
    if (u < 0 || u > length) continue
    const offsets = getWallFaceOffsets(wall)
    const face =
      !preferredHost && node.face && n > offsets.b && n < offsets.a
        ? node.face
        : n >= (offsets.a + offsets.b) / 2
          ? 'a'
          : 'b'
    let near = Math.abs(n - offsets[face])
    let bumpId: string | undefined
    for (const candidate of Object.values(nodes)) {
      if (
        candidate.type !== 'wall-feature' ||
        candidate.mode !== 'bump' ||
        candidate.parentId !== wall.id ||
        node.mode !== 'niche' ||
        candidate.visible === false
      )
        continue
      let p
      try {
        p = resolveWallFeaturePlacement(nodes, candidate)
      } catch {
        continue
      }
      if (
        (!preferredHost || preferredHost === candidate.id) &&
        p.face === face &&
        u >= p.bounds.u0 &&
        u <= p.bounds.u1 &&
        (preferredHost === candidate.id || (n >= p.bounds.n0 - 0.05 && n <= p.bounds.n1 + 0.05))
      ) {
        bumpId = candidate.id
        near = Math.min(
          near,
          n >= p.bounds.n0 && n <= p.bounds.n1 ? 0 : Math.abs(n - p.surfaceOffset),
        )
        break
      }
    }
    if (preferredHost && preferredHost !== wall.id && preferredHost !== bumpId) continue
    if (near > 0.5 || near >= distance) continue
    const support = wallSupportForNodes(wall, nodes)
    const run = support.faceDatum[face].find((r) => u / length >= r.start && u / length <= r.end)
    const base = bumpId
      ? resolveWallFeaturePlacement(nodes, nodes[bumpId] as WallFeatureNode).bottom
      : run
        ? supportSegmentAt(run, u / length)
        : support.elevation
    best = { wallId: wall.id, face, u, elevation: base + node.bottom + node.height / 2, bumpId }
    distance = near
  }
  return best
}
export function wallFeaturePlanSnap(force = false): WallFeatureSnap {
  return {
    gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : undefined,
    magnetic: isMagneticSnapActive(),
    force,
    vertical: false,
  }
}

export const wallFeaturePlanMove: FloorplanMoveTarget<WallFeatureNode> = ({ node, sceneApi }) => {
  if (!sceneApi) throw Error('Feature movement requires a scene API.')
  const session = createWallFeaturePlacementSession(node, sceneApi, true)
  const placement = resolveWallFeaturePlacement(sceneApi.nodes(), node)
  const levelId = placement.wall.parentId
  let valid = false
  return {
    affectedIds: [node.id],
    apply({ planPoint, modifiers }) {
      useInteractionScope.getState().update({ view: '2d' })
      const hit = wallFeaturePlanHit(
        sceneApi.nodes(),
        { ...node, ...useLiveNodeOverrides.getState().get(node.id) },
        planPoint,
        levelId,
      )
      const proposal = session.update(hit, wallFeaturePlanSnap(modifiers.altKey))
      valid = !!proposal?.placement
      usePlacementPreview.getState().set(valid ? proposal!.node : null)
    },
    canCommit: () => valid,
    commit() {
      session.commit()
      usePlacementPreview.getState().clear()
    },
    cancel() {
      const owned = session.ownsPreview()
      session.cancel()
      if (owned || useInteractionScope.getState().scope.kind === 'idle')
        usePlacementPreview.getState().clear()
    },
  }
}

export const wallFeaturePlanAffordance: FloorplanAffordance<WallFeatureNode> = {
  interaction: 'resize',
  start({ node, payload, nodes, sceneApi, gridSnapStep }) {
    if (!sceneApi) throw Error('Feature editing requires a scene API.')
    const p = resolveWallFeaturePlacement(nodes, node)
    const action = (payload as { action: string }).action
    let patch: Partial<WallFeatureNode> = {}
    let valid = false
    deferWallFeatureGeometry(node.id, true)
    const clear = () => {
      useLiveNodeOverrides.getState().clearFields(node.id, Object.keys(patch))
      clearWallFeatureEditPreview(node.id)
      deferWallFeatureGeometry(node.id, false)
    }
    return {
      affectedIds: [node.id],
      apply({ planPoint, modifiers }) {
        const x = planPoint[0] - p.wall.start[0],
          z = planPoint[1] - p.wall.start[1]
        let u = x * p.tangent[0] + z * p.tangent[2],
          n = -x * p.tangent[2] + z * p.tangent[0]
        if (!modifiers.altKey && isGridSnapActive() && gridSnapStep > 0) {
          u = Math.round(u / gridSnapStep) * gridSnapStep
          n = Math.round(n / gridSnapStep) * gridSnapStep
        }
        if (action === 'depth' && !modifiers.altKey && isGridSnapActive() && gridSnapStep > 0)
          n = -x * p.tangent[2] + z * p.tangent[0]
        const width = action === 'width-start' ? p.bounds.u1 - u : u - p.bounds.u0
        const candidate: Partial<WallFeatureNode> =
          action === 'depth'
            ? {
                depth:
                  (n - p.mountOffset) * (p.face === 'a' ? 1 : -1) * (node.mode === 'bump' ? 1 : -1),
              }
            : action === 'width-start'
              ? { width, u: node.u + (u - p.bounds.u0) / 2 }
              : { width, u: node.u + (width - node.width) / 2 }
        if (
          candidate.depth !== undefined &&
          !modifiers.altKey &&
          isGridSnapActive() &&
          gridSnapStep > 0
        )
          candidate.depth = Math.round(candidate.depth / gridSnapStep) * gridSnapStep
        try {
          planWallFeaturePlacement(sceneApi.nodes(), { ...node, ...candidate })
          patch = candidate
          valid = true
          useLiveNodeOverrides.getState().set(node.id, patch)
          showWallFeatureEditPreview({ ...node, ...patch }, sceneApi)
        } catch {
          valid = Object.keys(patch).length > 0
        }
      },
      canCommit: () => valid,
      commit() {
        try {
          if (!useScene.getState().readOnly && valid) {
            const latest = sceneApi.get(node.id)
            if (latest?.type === 'wall-feature') {
              planWallFeaturePlacement(sceneApi.nodes(), { ...latest, ...patch })
              sceneApi.update(node.id, patch)
            }
          }
        } finally {
          clear()
        }
      },
      cancel: clear,
    }
  },
}
