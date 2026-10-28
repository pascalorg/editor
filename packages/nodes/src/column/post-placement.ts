import {
  type AnyNode,
  type AnyNodeId,
  type BeamNode,
  beamBottomElevation,
  type ColumnNode,
  type ColumnPostBase,
  createFramingPost,
  DEFAULT_FRAMING_POST_SIZE,
  emitter,
  FRAMING_POST_SIZES,
  type FramingPostSize,
  framingPostFields,
  framingPostSize,
  framingPostTopAt,
  getFloorPlacedElevation,
  postStationsAlong,
  type WallNode,
} from '@pascal-app/core'
import {
  getMovingNode,
  isGridSnapActive,
  snapBuildingLocalToWorldGrid,
  snapWallDraftPointDetailed,
  useEditor,
  type WallDraftSnapKind,
  type WallPlanPoint,
} from '@pascal-app/editor'

type Nodes = Readonly<Record<AnyNodeId, AnyNode>>

/** Posts no further apart than this under a beam the panel posts: 8 ft, as a porch's are. */
export const FRAMING_POST_SPACING = 8 * 12 * 0.0254

/** The post choices the Post tool draws with, kept on the column tool's defaults. */
export type FramingPostToolChoices = { size: FramingPostSize; base: ColumnPostBase }

/**
 * The Post tool is the column tool armed with a framing post's fields (`toolDefaults.column`,
 * `role: 'post'`): its size and base, or null while it places ornamental columns.
 */
export function framingPostToolChoices(
  defaults: Readonly<Record<string, unknown>> | null | undefined,
): FramingPostToolChoices | null {
  if (defaults?.role !== 'post') return null
  const width = typeof defaults.width === 'number' ? defaults.width : undefined
  const size =
    (width !== undefined && framingPostSize({ width, depth: width })) || DEFAULT_FRAMING_POST_SIZE
  const base = defaults.postBase
  return {
    size,
    base: base === 'post-base' || base === 'pier' ? base : 'none',
  }
}

/** The column tool's defaults that make it the Post tool: a post of this size and base. */
export function framingPostToolDefaults(
  size: FramingPostSize = DEFAULT_FRAMING_POST_SIZE,
  base: ColumnPostBase = 'none',
): Record<string, unknown> {
  return { ...framingPostFields(size, base) }
}

/**
 * Drops a preset still following the cursor (a column preset's clone on the move tool): while it
 * moves, no build tool mounts.
 */
export function dropInflightColumnPlacement(): void {
  if (!getMovingNode()) return
  emitter.emit('tool:cancel')
  useEditor.getState().setMovingNode(null)
}

/**
 * The size and base last picked, kept apart from the tool's defaults: a host clears those when it
 * arms the column tool from a tile, and the Post tile should come back as the user left it.
 */
let lastChoices: FramingPostToolChoices = { size: DEFAULT_FRAMING_POST_SIZE, base: 'none' }

/**
 * Arms the column tool as the Post tool (the Build panel's Post tile): a post of `size` on `base`,
 * else as the tool has them, else as they were last picked.
 */
export function armFramingPostTool(size?: FramingPostSize, base?: ColumnPostBase): void {
  dropInflightColumnPlacement()
  const editor = useEditor.getState()
  const current = framingPostToolChoices(editor.toolDefaults.column) ?? lastChoices
  lastChoices = { size: size ?? current.size, base: base ?? current.base }
  editor.setToolDefaults('column', framingPostToolDefaults(lastChoices.size, lastChoices.base))
  if (!(editor.mode === 'build' && editor.tool === 'column'))
    editor.armToolMode({ mode: 'build', tool: 'column' })
}

/** A point the wall snap reads as a wall: a segment of no length catches at the point. */
function pointReference(id: string, parentId: string | null, at: WallPlanPoint): WallNode {
  return {
    object: 'node',
    id: id as WallNode['id'],
    type: 'wall',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    start: at,
    end: at,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

/**
 * What a post set on `levelId` snaps to: each beam's centreline (its ends, its middle and its run,
 * so a post lands under a beam end or anywhere along it) and the other posts' and columns'
 * centres.
 */
export function postSnapTargets(
  nodes: Nodes,
  levelId: string,
  ignoreIds: readonly string[] = [],
): WallNode[] {
  const targets: WallNode[] = []
  for (const node of Object.values(nodes)) {
    if (node.parentId !== levelId || node.visible === false || ignoreIds.includes(node.id)) continue
    if (node.type === 'beam') {
      targets.push({ ...pointReference(node.id, node.parentId, node.start), end: node.end })
    } else if (node.type === 'column') {
      targets.push(pointReference(node.id, node.parentId, [node.position[0], node.position[2]]))
    }
  }
  return targets
}

/**
 * A post's plan point, snapped: a beam end, a point along a beam or another post catch it within
 * the snap's reach, otherwise the grid while it snaps. `free` (Alt) places it as it is.
 */
export function snapPostPoint(args: {
  point: WallPlanPoint
  nodes: Nodes
  levelId: string
  ignoreIds?: readonly string[]
  free?: boolean
}): { point: WallPlanPoint; snap: WallDraftSnapKind | null } {
  if (args.free) return { point: args.point, snap: null }
  const step = useEditor.getState().gridSnapStep
  const grid = isGridSnapActive()
  const result = snapWallDraftPointDetailed({
    point: args.point,
    walls: postSnapTargets(args.nodes, args.levelId, args.ignoreIds),
    // Beams and posts always catch a post; the grid is the snapping mode's to give.
    magnetic: true,
    gridSnap: (point) => (grid ? snapBuildingLocalToWorldGrid(point, step) : point),
  })
  return { point: result.point, snap: result.snap }
}

/** What a framing post stands on at a point: the support the floor stacking elects under it. */
export type PostFoot = (post: ColumnNode) => number

/** The runtime foot: the elected support's top under the post, plus its own lift. */
export const electedPostFoot =
  (nodes: Nodes, levelId: string): PostFoot =>
  (post) =>
    getFloorPlacedElevation({
      node: post as AnyNode,
      nodes: nodes as Record<string, AnyNode>,
      position: post.position,
      levelId,
    }) + post.position[1]

/**
 * A framing post at a plan point, standing from its foot up to the underside of the beam over it,
 * else to the ceiling plane: what the Post tool places, and its ghost.
 */
export function framingPostAt(args: {
  nodes: Nodes
  levelId: string
  point: WallPlanPoint
  choices: FramingPostToolChoices
  foot: PostFoot
}): { post: ColumnNode; beamId: string | null } {
  const draft = createFramingPost({
    position: args.point,
    size: args.choices.size,
    base: args.choices.base,
    levelId: args.levelId,
  })
  const base = args.foot(draft)
  const { top, beamId } = framingPostTopAt(args.nodes, args.levelId, args.point, {
    baseElevation: base,
    side: FRAMING_POST_SIZES[args.choices.size],
  })
  return {
    post: createFramingPost({
      position: args.point,
      size: args.choices.size,
      base: args.choices.base,
      levelId: args.levelId,
      height: top - base,
    }),
    beamId,
  }
}

/**
 * Posts under a beam: one at each end and evenly between, no further apart than `spacing`, each
 * from its foot up to this beam's underside. Skips a station a post already stands at.
 */
export function framingPostsUnderBeam(args: {
  nodes: Nodes
  beam: BeamNode
  choices: FramingPostToolChoices
  foot: PostFoot
  spacing?: number
}): ColumnNode[] {
  const levelId = args.beam.parentId
  if (!levelId) return []
  const standing = Object.values(args.nodes).filter(
    (node): node is ColumnNode => node.type === 'column' && node.parentId === levelId,
  )
  const underside = beamBottomElevation(args.nodes, args.beam)
  return postStationsAlong(args.beam.start, args.beam.end, args.spacing ?? FRAMING_POST_SPACING)
    .filter(
      (point) =>
        !standing.some(
          (post) =>
            Math.hypot(post.position[0] - point[0], post.position[2] - point[1]) <
            Math.max(post.width, FRAMING_POST_SIZES[args.choices.size]),
        ),
    )
    .map((point) => {
      const fields = { position: point, ...args.choices, levelId }
      const foot = args.foot(createFramingPost(fields))
      return createFramingPost({ ...fields, height: underside - foot })
    })
}
