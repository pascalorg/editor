import {
  type AnyNode,
  type FloorplanAffordance,
  type FloorplanMoveTarget,
  LawnBuildError,
  LawnNode,
  planLawn,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import {
  sitePlanToSite,
  sitePointsCenter,
  snapSiteCursorValue,
  wrapSiteFloorplanMoveTarget,
} from '../shared/site-floorplan-move'
import { createLawnOutlineSession } from './definition.edit-session'
import { snapLawnPoint } from './placement'

type Point = [number, number]
type LawnMovePatch = Pick<LawnNode, 'outline' | 'strokes'>

function translatedLawn(node: LawnNode, dx: number, dz: number): LawnMovePatch {
  const translate = ([x, z]: Point): Point => [x + dx, z + dz]
  return {
    outline: node.outline.map(translate),
    strokes: node.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map(translate) })),
  }
}

function validatedMove(node: LawnNode, patch: LawnMovePatch): LawnNode | null {
  const parsed = LawnNode.safeParse({ ...node, ...patch })
  if (!parsed.success) return null
  try {
    planLawn(parsed.data, useScene.getState().nodes)
    return parsed.data
  } catch (error) {
    if (!(error instanceof LawnBuildError)) throw error
    return null
  }
}

export function lawnPlanToSite(node: LawnNode, nodes: Readonly<Record<string, AnyNode>>) {
  return sitePlanToSite(node, nodes)
}

export const createLawnMoveSession: FloorplanMoveTarget<LawnNode> = ({ node }) => {
  const centre = sitePointsCenter(node.outline)
  const resolve = createFloorplanCursorResolver({ original: centre, metadata: node.metadata })
  let patch: LawnMovePatch | null = null
  const current = () => {
    const live = useScene.getState().nodes[node.id]
    return live?.type === 'lawn' && live.outline === node.outline && live.strokes === node.strokes
      ? live
      : null
  }
  const clear = () => {
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
  }
  const canCommit = () => {
    const live = current()
    if (!patch || !live) return false
    return validatedMove(live, patch) !== null
  }
  return {
    affectedIds: [node.id],
    apply({ planPoint, modifiers }) {
      const target = resolve(planPoint, { snap: snapSiteCursorValue(modifiers) })
      const dx = target[0] - centre[0],
        dz = target[1] - centre[1]
      patch = null
      const live = current()
      if (!live || (!dx && !dz)) {
        clear()
        return
      }
      const proposed = validatedMove(live, translatedLawn(node, dx, dz))
      if (!proposed) {
        clear()
        return
      }
      patch = { outline: proposed.outline, strokes: proposed.strokes }
      useLiveNodeOverrides.getState().set(node.id, patch)
      useScene.getState().markDirty(node.id)
    },
    canCommit,
    commit() {
      if (canCommit() && patch) useScene.getState().updateNode(node.id, patch)
      patch = null
      clear()
    },
  }
}

export const lawnFloorplanMoveTarget: FloorplanMoveTarget<LawnNode> =
  wrapSiteFloorplanMoveTarget(createLawnMoveSession)

type Mode = 'move-vertex' | 'add-vertex' | 'move-edge' | 'delete-vertex'
function payloadIndex(payload: unknown, key: 'vertexIndex' | 'edgeIndex'): number {
  if (!payload || typeof payload !== 'object') return -1
  const value =
    key === 'vertexIndex'
      ? 'vertexIndex' in payload
        ? payload.vertexIndex
        : undefined
      : 'edgeIndex' in payload
        ? payload.edgeIndex
        : undefined
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1
}

export function lawnOutlineAffordance(mode: Mode): FloorplanAffordance<LawnNode> {
  return {
    start({ node, nodes, payload, initialPlanPoint }) {
      const vertexIndex = payloadIndex(payload, 'vertexIndex')
      const edgeIndex = payloadIndex(payload, 'edgeIndex')
      const toSite = lawnPlanToSite(node, nodes)
      const origin = toSite([initialPlanPoint[0], initialPlanPoint[1]])
      const ring = node.outline.map(([x, z]): Point => [x, z])
      const session = createLawnOutlineSession(node)
      const a = ring[edgeIndex],
        b = ring[(edgeIndex + 1) % ring.length]
      let index = vertexIndex
      if (mode === 'add-vertex' && a && b) {
        index = edgeIndex + 1
        ring.splice(index, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
      }
      if (mode === 'delete-vertex' && ring.length > 3 && ring[index])
        session.preview(ring.filter((_, i) => i !== index))
      return {
        affectedIds: session.affectedIds,
        apply({ planPoint, modifiers }) {
          if (mode === 'delete-vertex') return
          const point = snapLawnPoint(toSite([planPoint[0], planPoint[1]]), modifiers.altKey)
          if (mode === 'move-edge') {
            if (!a || !b) return
            const length = Math.hypot(b[0] - a[0], b[1] - a[1])
            if (length < 1e-6) return
            const normal: Point = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
            const distance = (point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1]
            session.preview(
              ring.map(
                (p, i): Point =>
                  i === edgeIndex || i === (edgeIndex + 1) % ring.length
                    ? [p[0] + normal[0] * distance, p[1] + normal[1] * distance]
                    : p,
              ),
            )
          } else if (ring[index]) session.preview(ring.map((p, i) => (i === index ? point : p)))
        },
        canCommit: session.canCommit,
        commit: session.commit,
      }
    },
  }
}
