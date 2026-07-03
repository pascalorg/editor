import type {
  AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
} from '@pascal-app/core'

const BODY_FILL = '#ddd6c8'
const BODY_STROKE = '#7c7468'

export function buildCabinetFloorplan(
  node: CabinetNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const modules = ctx.children.filter(
    (child): child is CabinetModuleNode => child.type === 'cabinet-module',
  )
  if (modules.length === 0) return null

  const minX = Math.min(...modules.map((module) => module.position[0] - module.width / 2))
  const maxX = Math.max(...modules.map((module) => module.position[0] + module.width / 2))
  const maxDepth = Math.max(...modules.map((module) => module.depth), node.depth)
  const width = Math.max(0.01, maxX - minX)
  const centerX = (minX + maxX) / 2
  return buildCabinetLikeFloorplan(node.position, node.rotation, width, maxDepth, ctx, centerX)
}

export function buildCabinetModuleFloorplan(
  node: CabinetModuleNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (ctx.parent?.type === 'cabinet') {
    const parent = ctx.parent as CabinetNode
    const world = composeChild(parent.position, parent.rotation, node.position)
    return buildCabinetLikeFloorplan(
      world.position,
      parent.rotation + node.rotation,
      node.width,
      node.depth,
      ctx,
    )
  }
  // A nested wall cabinet: parent is a base cabinet-module, whose own parent is the run.
  if (ctx.parent?.type === 'cabinet-module') {
    const baseModule = ctx.parent as CabinetModuleNode
    const run = ctx.resolve<CabinetNode>(baseModule.parentId as AnyNodeId)
    if (run?.type === 'cabinet') {
      const base = composeChild(run.position, run.rotation, baseModule.position)
      const world = composeChild(base.position, run.rotation, node.position)
      return buildCabinetLikeFloorplan(
        world.position,
        run.rotation + node.rotation,
        node.width,
        node.depth,
        ctx,
      )
    }
  }
  return buildCabinetLikeFloorplan(node.position, node.rotation, node.width, node.depth, ctx)
}

function composeChild(
  parentPosition: readonly [number, number, number],
  parentRotation: number,
  childPosition: readonly [number, number, number],
): { position: [number, number, number] } {
  const cos = Math.cos(parentRotation)
  const sin = Math.sin(parentRotation)
  const [lx, ly, lz] = childPosition
  return {
    position: [
      parentPosition[0] + lx * cos + lz * sin,
      parentPosition[1] + ly,
      parentPosition[2] - lx * sin + lz * cos,
    ],
  }
}

function buildCabinetLikeFloorplan(
  position: readonly [number, number, number],
  rotation: number,
  width: number,
  depth: number,
  ctx: GeometryContext,
  localCenterX = 0,
): FloorplanGeometry | null {
  const [cx, , cz] = position
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const hw = width / 2
  const hd = depth / 2
  const corner = (lx: number, lz: number): FloorplanPoint => [
    cx + (lx + localCenterX) * cos + lz * sin,
    cz - (lx + localCenterX) * sin + lz * cos,
  ]
  const points: FloorplanPoint[] = [
    corner(-hw, -hd),
    corner(hw, -hd),
    corner(hw, hd),
    corner(-hw, hd),
  ]
  const frontLeft = corner(-hw * 0.7, hd * 0.82)
  const frontRight = corner(hw * 0.7, hd * 0.82)
  const showSelectedChrome = (ctx.viewState?.selected || ctx.viewState?.highlighted) ?? false
  const stroke =
    showSelectedChrome && ctx.viewState?.palette
      ? ctx.viewState.palette.selectedStroke
      : BODY_STROKE

  return {
    kind: 'group',
    children: [
      {
        kind: 'polygon',
        points,
        fill: BODY_FILL,
        stroke,
        strokeWidth: showSelectedChrome ? 0.03 : 0.02,
        opacity: 0.95,
      },
      {
        kind: 'line',
        x1: frontLeft[0],
        y1: frontLeft[1],
        x2: frontRight[0],
        y2: frontRight[1],
        stroke,
        strokeWidth: 1,
        vectorEffect: 'non-scaling-stroke',
        opacity: 0.8,
      },
      ...(showSelectedChrome
        ? [{ kind: 'move-handle' as const, point: [cx, cz] as [number, number] }]
        : []),
    ],
  }
}
