import { getLevelPresentationY, useViewer } from '@pascal-app/viewer'
import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  type FenceConstructionOptions as FenceCommitOptions,
  FenceNode,
  floorConstructionLift,
  nodeRegistry,
  getFenceCenterlineLength,
  getFenceSplineLength,
  resolveFenceConstructionSupport,
  type SceneApi,
  sampleFenceCenterline,
  snapPointAlongAngleRay,
  type WallNode,
} from '@pascal-app/core'
import {
  findWallSnapTarget,
  getSegmentGridStep,
  isSegmentLongEnough,
  snapPointToGrid,
  triggerSFX,
  useEditor,
  type WallPlanPoint,
} from '@pascal-app/editor'

export type FencePlanPoint = WallPlanPoint

export type FenceDraftContext = {
  sceneApi: SceneApi
  levelId: AnyNodeId | null
}

const INHERITED_FENCE_FIELDS = [
  'height',
  'thickness',
  'material',
  'materialPreset',
  'slots',
  'baseHeight',
  'postSpacing',
  'picketSpacing',
  'patternDistribution',
  'patternAlignment',
  'patternCount',
  'patternRemainder',
  'picketWidth',
  'picketTop',
  'picketRailCount',
  'picketProfile',
  'picketTopClearance',
  'picketVariation',
  'picketRailProjection',
  'postSize',
  'topRailHeight',
  'groundClearance',
  'edgeInset',
  'slatGap',
  'postCap',
  'baseStyle',
  'surfaceMode',
  'supportOffset',
  'transitionMode',
  'transitionWidth',
  'showInfill',
  'infillPlacement',
  'color',
  'style',
] as const satisfies readonly (keyof FenceNode)[]

export function getFenceInheritedDefaults(
  start: FencePlanPoint,
  context: FenceDraftContext,
  currentNodes: ReturnType<SceneApi['nodes']> = context.sceneApi.nodes(),
): Partial<FenceNode> | null {
  const { levelId } = context
  if (!levelId) return null
  const nodes = currentNodes
  const source = Object.values(nodes).find(
    (node): node is FenceNode =>
      node.type === 'fence' &&
      node.parentId === levelId &&
      node.visible !== false &&
      [node.start, node.end].some((point) => distanceSquared(start, point) < 0.001 ** 2),
  )
  if (!source) return null
  const defaults: Record<string, unknown> = {}
  for (const field of INHERITED_FENCE_FIELDS) {
    if (source[field] !== undefined) defaults[field] = source[field]
  }
  return defaults as Partial<FenceNode>
}

const FENCE_CORNER_SNAP_RADIUS = 0.28
const FENCE_SPAN_SNAP_RADIUS = 0.16

const FENCE_CORNER_SNAP_RADIUS = 0.28
const FENCE_SPAN_SNAP_RADIUS = 0.16

export function getFenceDrawingSurface(
  nodes: Record<string, AnyNode> = useScene.getState().nodes,
  id = useEditor.getState().toolDefaults.fence?.supportSurfaceId,
  levelId = useViewer.getState().selection.levelId,
  levelMode = useViewer.getState().levelMode,
) {
  if (typeof id !== 'string') return null
  const node = nodes[id as AnyNodeId]
  if (!node?.parentId || node.parentId !== levelId || node.visible === false) return null
  const top = nodeRegistry.get(node.type)?.capabilities?.surfaces?.top
  if (!top?.boundary) return null
  const position = (node as unknown as { position: number[] }).position
  const height = typeof top.height === 'function' ? top.height(node, { nodes }) : top.height
  return {
    id,
    boundary: top.boundary(node, 0.08),
    levelElevation: getLevelPresentationY(node.parentId, nodes, levelMode),
    elevation: (position?.[1] ?? 0) + height + floorConstructionLift(nodes, node),
  }
}

function findSurfaceSnapTarget(point: FencePlanPoint): FencePlanPoint | null {
  const surface = getFenceDrawingSurface()
  if (!surface) return null
  let corner: FencePlanPoint | null = null
  let edge: FencePlanPoint | null = null
  let cornerDistance = FENCE_CORNER_SNAP_RADIUS ** 2
  let edgeDistance = FENCE_SPAN_SNAP_RADIUS ** 2
  for (let index = 0; index < surface.boundary.length; index++) {
    const a = surface.boundary[index]!
    const b = surface.boundary[(index + 1) % surface.boundary.length]!
    const candidate: FencePlanPoint = [a[0], a[1]]
    const distance = distanceSquared(point, candidate)
    if (distance <= cornerDistance) {
      corner = candidate
      cornerDistance = distance
    }
    const projection = projectPointOntoSegment(point, { start: candidate, end: [b[0], b[1]] })
    if (projection) {
      const distance = distanceSquared(point, projection)
      if (distance <= edgeDistance) {
        edge = projection
        edgeDistance = distance
      }
    }
  }
  return corner ?? edge
}

type SegmentNode = {
  start: FencePlanPoint
  end: FencePlanPoint
}

function distanceSquared(a: FencePlanPoint, b: FencePlanPoint): number {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

function projectPointOntoSegment(
  point: FencePlanPoint,
  segment: SegmentNode,
): FencePlanPoint | null {
  const [x1, z1] = segment.start
  const [x2, z2] = segment.end
  const dx = x2 - x1
  const dz = z2 - z1
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) {
    return null
  }

  const t = Math.max(0, Math.min(1, ((point[0] - x1) * dx + (point[1] - z1) * dz) / lengthSquared))

  return [x1 + dx * t, z1 + dz * t]
}

function findFenceSnapTarget(
  point: FencePlanPoint,
  fences: FenceNode[],
  ignoreFenceIds: string[] = [],
): FencePlanPoint | null {
  const cornerRadiusSquared = FENCE_CORNER_SNAP_RADIUS ** 2
  const spanRadiusSquared = FENCE_SPAN_SNAP_RADIUS ** 2
  const ignoredFenceIds = new Set(ignoreFenceIds)
  let bestCornerTarget: FencePlanPoint | null = null
  let bestCornerDistanceSquared = Number.POSITIVE_INFINITY
  let bestSpanTarget: FencePlanPoint | null = null
  let bestSpanDistanceSquared = Number.POSITIVE_INFINITY

  for (const fence of fences) {
    if (ignoredFenceIds.has(fence.id)) {
      continue
    }

    for (const candidate of [fence.start, fence.end]) {
      const candidateDistanceSquared = distanceSquared(point, candidate)
      if (
        candidateDistanceSquared > cornerRadiusSquared ||
        candidateDistanceSquared >= bestCornerDistanceSquared
      ) {
        continue
      }

      bestCornerTarget = candidate
      bestCornerDistanceSquared = candidateDistanceSquared
    }

    const samples = sampleFenceCenterline(
      fence,
      Math.max(32, Math.ceil(getFenceCenterlineLength(fence) / 0.1)),
    )
    for (let index = 1; index < samples.length; index += 1) {
      const a = samples[index - 1]!
      const b = samples[index]!
      const candidate = projectPointOntoSegment(point, {
        start: [a.x, a.y],
        end: [b.x, b.y],
      })
      if (!candidate) continue
      const candidateDistanceSquared = distanceSquared(point, candidate)
      if (
        candidateDistanceSquared > spanRadiusSquared ||
        candidateDistanceSquared >= bestSpanDistanceSquared
      )
        continue
      bestSpanTarget = candidate
      bestSpanDistanceSquared = candidateDistanceSquared
    }
  }

  return bestCornerTarget ?? bestSpanTarget
}

export function snapFenceDraftPoint(args: {
  point: FencePlanPoint
  walls: WallNode[]
  fences: FenceNode[]
  start?: FencePlanPoint
  angleSnap?: boolean
  ignoreFenceIds?: string[]
  bypassSnap?: boolean
  magnetic?: boolean
  /** Override the grid step. */
  step?: number
  /**
   * Optional grid-snap function. When provided, replaces the default
   * local-axis snap — lets the 2D floor-plan keep snapping to the
   * world XZ grid even when the building is rotated. Wall / fence
   * endpoint snap precedence is preserved.
   */
  gridSnap?: (point: FencePlanPoint) => FencePlanPoint
}): FencePlanPoint {
  if (useEditor.getState().toolDefaults.fence?.featurePlacement) return args.point
  const {
    point,
    walls,
    fences,
    start,
    angleSnap = false,
    ignoreFenceIds,
    bypassSnap = false,
    magnetic = true,
    step,
    gridSnap,
  } = args
  if (bypassSnap) return point

  const gridStep = step ?? getSegmentGridStep()

  // Magnetic endpoint snap must beat the angle lock, and the lock can pull
  // the cursor far enough off an endpoint that probing the locked point
  // would never engage — so under the lock, probe from the RAW cursor
  // first (mirrors `snapWallDraftPointDetailed`'s special-point pre-pass).
  if (start && angleSnap) {
    const rawTarget =
      magnetic &&
      (findFenceSnapTarget(point, fences, ignoreFenceIds) ?? findWallSnapTarget(point, walls))
    if (rawTarget) return rawTarget
  }

  // The angle path snaps the distance ALONG the 15° ray — a scalar, the
  // same in world and local frames — so the `gridSnap` world-grid override
  // only applies when the angle lock is off.
  const basePoint: FencePlanPoint =
    start && angleSnap
      ? [...snapPointAlongAngleRay(start, point, DEFAULT_ANGLE_STEP, gridStep)]
      : gridSnap
        ? gridSnap(point)
        : snapPointToGrid(point, gridStep)
  if (!magnetic) return basePoint

  const fenceSnapTarget = findFenceSnapTarget(basePoint, fences, ignoreFenceIds)
  return fenceSnapTarget ?? findWallSnapTarget(basePoint, walls) ?? basePoint
}

function getFenceDefaultsForCurrentLevel() {
  const defaults = useEditor.getState().toolDefaults.fence ?? {}
  if (typeof defaults.supportSurfaceId !== 'string' || getFenceDrawingSurface()) return defaults
  const { supportSurfaceId: _supportSurfaceId, ...unhostedDefaults } = defaults
  return unhostedDefaults
}

export function createFenceOnCurrentLevel(
  start: FencePlanPoint,
  end: FencePlanPoint,
  options: FenceCommitOptions | undefined,
  context: FenceDraftContext,
): FenceNode | null {
  const { sceneApi, levelId: currentLevelId } = context
  const nodes = sceneApi.nodes()

  if (!(currentLevelId && isSegmentLongEnough(start, end))) {
    return null
  }

  const fenceCount = Object.values(nodes).filter((node) => node.type === 'fence').length
  // Build parameters seeded by a placed preset (height, style, post
  // spacing, …) merge in first; `name`/`start`/`end` always win. The
  // schema parse validates and drops anything unexpected.
  const defaults = {
    ...getFenceDefaultsForCurrentLevel(),
    ...getFenceInheritedDefaults(start, context),
  }
  const authoredFence = FenceNode.parse({
    ...defaults,
    name: `Fence ${fenceCount + 1}`,
    start,
    end,
  })
  // Fences run no per-frame support election — the persisted host IS the
  // lift (absent = level floor), so elect it at commit, pointer-capped.
  const fence = resolveFenceConstructionSupport(authoredFence, currentLevelId, nodes, options)

  sceneApi.upsert(fence, currentLevelId)
  triggerSFX('sfx:structure-build')

  return fence
}

/**
 * Commit a smooth spline fence from a list of drawn control points. The
 * centerline becomes a Catmull-Rom curve through `path`; `start`/`end` are
 * pinned to the first/last point so endpoint handles, bbox, and miter
 * references stay valid. Requires >= 2 points spanning a usable distance.
 */
export function createSplineFenceOnCurrentLevel(
  path: FencePlanPoint[],
  tangents: FenceNode['tangents'] | undefined,
  context: FenceDraftContext,
): FenceNode | null {
  const { sceneApi, levelId: currentLevelId } = context
  const nodes = sceneApi.nodes()

  if (!currentLevelId || path.length < 2) {
    return null
  }
  const start = path[0]!
  const end = path[path.length - 1]!
  // A degenerate single-point-ish path (all clicks on one spot) is rejected
  // the same way a too-short straight segment is.
  if (getFenceSplineLength(path, tangents) < 0.01) {
    return null
  }

  const fenceCount = Object.values(nodes).filter((node) => node.type === 'fence').length
  const defaults = {
    ...getFenceDefaultsForCurrentLevel(),
    ...getFenceInheritedDefaults(start, context),
  }
  const authoredFence = FenceNode.parse({
    ...defaults,
    name: `Fence ${fenceCount + 1}`,
    start,
    end,
    path,
    tangents,
  })
  const fence = authoredFence

  sceneApi.upsert(fence, currentLevelId)
  triggerSFX('sfx:structure-build')

  return fence
}
