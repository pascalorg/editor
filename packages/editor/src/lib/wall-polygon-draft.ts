import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  planWallInsertion,
  resolveWallConstruction,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallConstructionOptions,
  type WallNode,
  wallClosesRoom,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  chainEndJoinsExistingWall,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallPlanPoint,
} from '../components/tools/wall/wall-snap-geometry'
import useEditor, { isMagneticSnapActive } from '../store/use-editor'
import { useFloorplanDraftPreview } from '../store/use-floorplan-draft-preview'
import { sfxEmitter } from './sfx-bus'

/**
 * A Polygon room is draft state until it completes: its corners live in
 * `useFloorplanDraftPreview.wallPolygonDraftPoints` (drawn by the 3D tool and
 * the plan as ghosts) and no wall is written. Completing it — closing on the
 * first corner, sealing or teeing into existing walls, or a double-click —
 * writes every wall in one `applyNodeChanges` batch: one undo step, one scene
 * commit, and room detection derives the floor and ceiling from it. Esc, a
 * tool / shape / level change or a history command just drops the draft; the
 * scene, history, autosave and collaboration never saw it.
 *
 * One draft at a time: the 3D wall tool owns it, or the plan in 2D-only view.
 */

type Draft = {
  levelId: AnyNodeId
  construction?: WallConstructionOptions
  stopGuards: () => void
}

let draft: Draft | null = null

const points = () => useFloorplanDraftPreview.getState().wallPolygonDraftPoints
const setPoints = (next: readonly WallPlanPoint[]) =>
  useFloorplanDraftPreview.getState().setWallPolygonDraftPoints(next)

export function isWallPolygonDraftOpen(): boolean {
  return draft !== null
}

/** Starts a Polygon room at its first corner, replacing any open one. */
export function startWallPolygonDraft(
  levelId: AnyNodeId,
  start: WallPlanPoint,
  construction?: WallConstructionOptions,
): void {
  discardWallPolygonDraft()
  const abandon = () => {
    discardWallPolygonDraft()
    emitter.emit('tool:cancel')
  }
  // The corners are in this level's frame, and the view that started the
  // polygon owns its clicks (the 3D tool, or the plan in 2D-only view — a
  // hidden canvas keeps listening). A level or view switch abandons it and
  // tells the drafting tools to reset their chain, so ownership starts over.
  const viewMode = useEditor.getState().viewMode
  const stops = [
    useViewer.subscribe((state) => {
      if (state.selection.levelId !== levelId) abandon()
    }),
    useEditor.subscribe((state) => {
      if (state.viewMode !== viewMode) abandon()
    }),
  ]
  draft = {
    levelId,
    construction,
    stopGuards: () => {
      for (const stop of stops) stop()
    },
  }
  setPoints([start])
}

/** Drops the open polygon; nothing was written, so nothing is restored. */
export function discardWallPolygonDraft(): void {
  const current = draft
  draft = null
  current?.stopGuards()
  if (points().length) setPoints([])
}

const levelWallsOf = (nodes: Record<string, AnyNode>, levelId: AnyNodeId) =>
  Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )

/** Whether `point` lies on the straight segment `wall` (within 1 mm). */
function liesOnWall(point: WallPlanPoint, wall: WallNode): boolean {
  const [ax, az] = wall.start
  const [bx, bz] = wall.end
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared === 0) return false
  const t = ((point[0] - ax) * dx + (point[1] - az) * dz) / lengthSquared
  if (t < -1e-6 || t > 1 + 1e-6) return false
  return Math.hypot(ax + t * dx - point[0], az + t * dz - point[1]) <= 1e-3
}

/**
 * The polygon's walls planned against a scratch copy of the scene, the way
 * the chain used to write them one by one: each side joins the previous one,
 * splits the walls it tees into and skips what existing walls already cover.
 * `draftWalls` are every surviving piece of the polygon's own sides — a later
 * side that crosses an earlier one splits it into new walls, and those pieces
 * are still the polygon's (they take its construction settings); `last` is
 * the final side, for the tee / seal checks.
 */
function planPolygon(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: AnyNodeId,
  corners: WallPlanPoint[],
) {
  const virtual = { ...nodes }
  const draftIds = new Set<AnyNodeId>()
  let last: WallNode | undefined
  const joinRadius = isMagneticSnapActive() ? WALL_JOIN_SNAP_RADIUS : WALL_CONNECT_SNAP_RADIUS
  const wallDefaults = useEditor.getState().toolDefaults.wall ?? {}
  for (let index = 0; index < corners.length - 1; index++) {
    const result = planWallInsertion(virtual, {
      levelId,
      start: corners[index]!,
      end: corners[index + 1]!,
      joinRadius,
      wallDefaults,
    })
    if (!result.ok) continue
    const draftBefore = [...draftIds].flatMap((id) => {
      const node = virtual[id]
      return node?.type === 'wall' ? [node] : []
    })
    for (const id of result.plan.changes.delete) delete virtual[id]
    for (const { node, parentId } of result.plan.changes.create) {
      virtual[node.id] = { ...node, ...(parentId ? { parentId } : {}) } as AnyNode
    }
    for (const { id, data } of result.plan.changes.update) {
      if (virtual[id]) virtual[id] = { ...virtual[id], ...data } as AnyNode
    }
    for (const id of result.plan.changes.delete) draftIds.delete(id)
    const insertedIds = new Set(result.plan.insertedWalls.map((wall) => wall.id))
    for (const { node } of result.plan.changes.create) {
      if (node.type !== 'wall') continue
      const descends =
        insertedIds.has(node.id) ||
        draftBefore.some((side) => liesOnWall(node.start, side) && liesOnWall(node.end, side))
      if (descends) draftIds.add(node.id as AnyNodeId)
    }
    const final = result.plan.insertedWalls.at(-1)
    if (final) last = virtual[final.id] as WallNode | undefined
  }
  const draftWalls = [...draftIds].flatMap((id) => {
    const node = virtual[id]
    return node?.type === 'wall' ? [node] : []
  })
  return { virtual, draftWalls, last }
}

/**
 * The open polygon's sides as wall-shaped values — snap targets for the draft
 * (so the last click can land exactly on the first corner) and the ghosts.
 * Never written to the scene.
 */
export function wallPolygonDraftWalls(): WallNode[] {
  const current = draft
  if (!current) return []
  const corners = points()
  return corners.slice(1).map((end, index) => ({
    object: 'node',
    id: `wall_polygon_draft_${index}` as WallNode['id'],
    type: 'wall',
    name: 'Draft wall',
    parentId: current.levelId,
    visible: true,
    metadata: {},
    children: [],
    start: corners[index]!,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  }))
}

/**
 * How a corner left the polygon: still open, closed on its first corner,
 * ended on existing walls, or `ended` — there was no open polygon to add to
 * (it was committed or abandoned elsewhere), so the caller's chain ends too.
 */
export type WallPolygonCornerResult = 'open' | 'closed' | 'joined' | 'ended'

/**
 * Adds a corner. A corner within the join radius of the first one closes the
 * polygon (snapped exactly onto it); a corner that tees into an existing wall
 * or seals a room against the wall network ends it, as the chain did.
 */
export function addWallPolygonDraftCorner(corner: WallPlanPoint): WallPolygonCornerResult {
  const current = draft
  const corners = points()
  const first = corners[0]
  if (!(current && first)) return 'ended'
  const closes =
    corners.length >= 3 &&
    (corner[0] - first[0]) ** 2 + (corner[1] - first[1]) ** 2 <=
      WALL_JOIN_SNAP_RADIUS * WALL_JOIN_SNAP_RADIUS
  const next = [...corners, closes ? first : corner]
  setPoints(next)
  if (closes) return 'closed'

  const { virtual, draftWalls, last } = planPolygon(
    useScene.getState().nodes,
    current.levelId,
    next,
  )
  const levelWalls = last ? levelWallsOf(virtual, current.levelId) : []
  const joins =
    !!last &&
    (chainEndJoinsExistingWall(
      corner,
      levelWalls,
      draftWalls.map((wall) => wall.id),
    ) ||
      wallClosesRoom(levelWalls, last))
  // Each placed corner ticks like the Zone tool's; a close or a join is
  // answered by the build cue of the commit that follows.
  if (!joins) sfxEmitter.emit('sfx:structure-build-start')
  return joins ? 'joined' : 'open'
}

/**
 * Writes the polygon — one history step, one scene commit — and closes the
 * draft. Returns the walls it created (none for a draft without a side).
 */
export function commitWallPolygonDraft(): WallNode[] {
  const current = draft
  if (!current) return []
  const corners = points()
  discardWallPolygonDraft()
  if (corners.length < 2) return []

  const scene = useScene.getState()
  if (scene.readOnly) return []
  const { virtual, draftWalls } = planPolygon(scene.nodes, current.levelId, corners)
  if (!draftWalls.length) return []
  const construction = resolveWallConstruction(
    scene.nodes,
    current.levelId,
    draftWalls,
    current.construction,
  )
  const finalized = new Map(construction.walls.map((wall) => [wall.id, wall]))
  const created = Object.values(virtual).filter((node) => !scene.nodes[node.id])
  const update = Object.values(virtual)
    .filter((node) => scene.nodes[node.id] && node !== scene.nodes[node.id])
    .map((node) => ({ id: node.id, data: node as Partial<AnyNode> }))
  const source = construction.sourceSupportUpdate
  if (source) {
    const existing = update.find((operation) => operation.id === source.id)
    if (existing) existing.data = { ...existing.data, ...source.data }
    else update.push(source)
  }
  runAsSingleSceneHistoryStep(useScene, () =>
    scene.applyNodeChanges({
      create: created.map((node) => ({
        node: finalized.get(node.id as WallNode['id']) ?? node,
        parentId: node.parentId as AnyNodeId,
      })),
      update,
      delete: Object.keys(scene.nodes).filter((id) => !virtual[id as AnyNodeId]) as AnyNodeId[],
    }),
  )
  sfxEmitter.emit('sfx:structure-build')
  return construction.walls
}
