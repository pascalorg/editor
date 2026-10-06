import { refuseParamsWithoutScript } from '../agent-operations/add-object'
import { refuse } from '../agent-tools/refusal'
import { scriptedSize, scriptSource } from '../lib/geometry-script-node'
import { wallSupportForNodes } from '../lib/opening-floor-datum'
import {
  type AnyNode,
  type AnyNodeId,
  type CompiledGeometryScript,
  DoorNode,
  type GeometryScriptParamValue,
  getScaledDimensions,
  type ItemNode,
  type WallNode,
  WindowNode,
} from '../schema'
import { getCurtainWallConfig } from '../schema/nodes/curtain-wall'
import type { DoorType, WindowType } from '../schema/nodes/opening-types'
import { getWallPlaneTop } from '../services/storey'
import { resolveWallExteriorSide } from '../systems/wall/wall-assembly'
import { getWallCurveLength, isCurvedWall } from '../systems/wall/wall-curve'
import { resolveWallTop } from '../systems/wall/wall-top'
import {
  type DoorStyle,
  getDoorStyleOverrides,
  getWindowStyleOverrides,
  type WindowStyle,
} from './opening-style-presets'

// The placement rules of wall openings, shared by the editor's door and window tools and by
// every agent surface: what the editor lets a person do by hand is what an agent may do.

type Nodes = Readonly<Record<string, AnyNode>>

/** 1 µm: below any buildable difference, above floating-point noise. */
const TOUCHING = 1e-6

const lengthOf = (wall: Pick<WallNode, 'start' | 'end'>) =>
  Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])

/**
 * Available wall-local Y span for an opening hosted on `wall`: the wall's resolved top (storey
 * plane for plane-bound walls, stored height for explicit ones) minus the wall's elected slab
 * base, the ceiling an opening's top edge must stay under.
 */
export function resolveWallOpeningCeiling(
  wall: WallNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): number {
  const support = wallSupportForNodes(wall, nodes)
  return (
    resolveWallTop(
      wall,
      getWallPlaneTop(wall, wall.parentId ?? '', nodes as Record<string, AnyNode>),
      support.elevation,
    ) - support.elevation
  )
}

/** A curtain wall keeps its perimeter frame clear of openings. */
const openingMargin = (wall: WallNode) =>
  wall.wallType === 'curtain' ? getCurtainWallConfig(wall).perimeterWidth : 0

/** A door's centre: slid along the wall to stay on it, standing on the floor. */
export function clampDoorToWall(
  wall: WallNode,
  localX: number,
  width: number,
  height: number,
): { clampedX: number; clampedY: number } {
  const margin = openingMargin(wall)
  const length = getWallCurveLength(wall)
  const clampedX = Math.max(margin + width / 2, Math.min(length - margin - width / 2, localX))
  return { clampedX, clampedY: height / 2 }
}

/** A window's centre: slid to stay on the wall, and between the floor and the wall's ceiling. */
export function clampWindowToWall(
  wall: WallNode,
  localX: number,
  localY: number,
  width: number,
  height: number,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): { clampedX: number; clampedY: number } {
  const ceiling = resolveWallOpeningCeiling(wall, nodes)
  const margin = openingMargin(wall)
  const length = getWallCurveLength(wall)
  const clampedX = Math.max(margin + width / 2, Math.min(length - margin - width / 2, localX))
  const clampedY = Math.max(margin + height / 2, Math.min(ceiling - margin - height / 2, localY))
  return { clampedX, clampedY }
}

/**
 * The first child of the wall (door, window, or wall-mounted item) that a rectangle centred on
 * (`clampedX`, `clampedY`) would overlap. Items store their bottom Y; doors and windows their
 * centre Y.
 */
export function findWallChildOverlap(
  wallId: string,
  nodes: Nodes,
  clampedX: number,
  clampedY: number,
  width: number,
  height: number,
  ignoreId?: string,
): AnyNode | null {
  const wallNode = nodes[wallId] as WallNode | undefined
  if (!wallNode) return null
  const newBottom = clampedY - height / 2
  const newTop = clampedY + height / 2
  const newLeft = clampedX - width / 2
  const newRight = clampedX + width / 2

  for (const childId of Array.isArray(wallNode.children) ? wallNode.children : []) {
    if (childId === ignoreId) continue
    const child = nodes[childId]
    if (!child || child.metadata.isTransient) continue

    let childLeft: number
    let childRight: number
    let childBottom: number
    let childTop: number

    if (child.type === 'item') {
      const item = child as ItemNode
      if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') continue
      const [w, h] = getScaledDimensions(item)
      childLeft = item.position[0] - w / 2
      childRight = item.position[0] + w / 2
      childBottom = item.position[1]
      childTop = item.position[1] + h
    } else if (child.type === 'window' || child.type === 'door') {
      const opening = child as { position: [number, number, number]; width: number; height: number }
      childLeft = opening.position[0] - opening.width / 2
      childRight = opening.position[0] + opening.width / 2
      childBottom = opening.position[1] - opening.height / 2
      childTop = opening.position[1] + opening.height / 2
    } else {
      continue
    }

    // Edges that meet are not an overlap, even when a decimal position lands them a hair apart.
    if (
      newLeft < childRight - TOUCHING &&
      newRight > childLeft + TOUCHING &&
      newBottom < childTop - TOUCHING &&
      newTop > childBottom + TOUCHING
    )
      return child
  }
  return null
}

/** Whether a placement collides; a missing wall counts as blocked, as in the editor's tools. */
export function hasWallChildOverlap(
  wallId: string,
  nodes: Nodes,
  clampedX: number,
  clampedY: number,
  width: number,
  height: number,
  ignoreId?: string,
): boolean {
  if (!nodes[wallId]) return true
  return findWallChildOverlap(wallId, nodes, clampedX, clampedY, width, height, ignoreId) !== null
}

export type WallOpeningInput = {
  kind: 'door' | 'window'
  wallId?: string
  t?: number
  position?: number
  width?: number
  height?: number
  sillHeight?: number
  hingesSide?: 'left' | 'right'
  swingDirection?: 'inward' | 'outward'
  /** A door, or a passage with no leaf (a cased opening, an arch), as the editor's door panel. */
  openingKind?: 'door' | 'opening'
  style?: string
  force?: boolean
  openingShape?: 'rectangle' | 'rounded' | 'arch'
  archHeight?: number
  cornerRadius?: number
  doorType?: DoorType
  windowType?: WindowType
  columns?: number
  rows?: number
  /** A compiled script the opening is built from; its bounds set width and height. */
  compiled?: CompiledGeometryScript
  code?: string
  params?: Record<string, GeometryScriptParamValue>
}

const equalRatios = (count: number) => Array.from({ length: count }, () => 1 / count)

const DEFAULTS = {
  door: { width: 0.9, height: 2.1 },
  window: { width: 1.5, height: 1.5, sillHeight: 0.9 },
} as const

const metres = (value: number) => `${value.toFixed(2)} m`

/**
 * Plan a door or window on a wall with the editor's rules, or refuse with a code: the one
 * operation behind `add_door` / `add_window` on every agent surface. The caller creates
 * `node` under `wallId`.
 */
/**
 * Which way a door on `wall` faces: out, when the wall knows its outside. A door's swing and a
 * garage door's track run behind its facing (a garage door's track once ran on the street), so a door facing out opens and rolls inside, whichever way the wall was drawn. A wall
 * that does not know its outside, or an inside wall, keeps its front.
 */
export function doorFacing(wall: Pick<WallNode, 'frontSide' | 'backSide'>): {
  side?: 'front' | 'back'
  rotation: [number, number, number]
} {
  const outside = resolveWallExteriorSide(wall)
  if (outside === -1) return { side: 'back', rotation: [0, Math.PI, 0] }
  if (outside === 1) return { side: 'front', rotation: [0, 0, 0] }
  return { rotation: [0, 0, 0] }
}

/** The face a door placed by hand takes: out on an outside wall, else the face hovered. */
export const placedDoorFace = (
  wall: Pick<WallNode, 'frontSide' | 'backSide'>,
  hovered: 'front' | 'back',
): 'front' | 'back' => doorFacing(wall).side ?? hovered

export function planWallOpening(nodes: Nodes, input: WallOpeningInput) {
  refuseParamsWithoutScript(nodes, input)
  const { kind, wallId } = input
  if (!wallId)
    refuse(
      'wall_required',
      `Say which wall the ${kind} goes on (wallId), or pass nodeId to rebuild one.`,
    )
  const host = nodes[wallId]
  if (!host) refuse('wall_not_found', `Wall not found: ${wallId}.`, { wallId })
  if (host.type !== 'wall')
    refuse('not_a_wall', `Node ${wallId} is a ${host.type}, not a wall.`, {
      wallId,
      type: host.type,
    })
  const wall = host as WallNode
  if (isCurvedWall(wall))
    refuse(
      'curved_wall',
      `Wall ${wallId} is curved; doors and windows go on straight walls, as in the editor.`,
      { wallId },
    )

  const { t, position } = input
  if (t !== undefined && position !== undefined && Math.abs(t - position) > 1e-9)
    refuse(
      'conflicting_position',
      `t (${t}) and position (${position}) disagree; they are the same field, pass one.`,
      { t, position },
    )
  const along = t ?? position
  if (along === undefined)
    refuse(
      'position_required',
      'Say where on the wall: t (or position) from 0 at its start to 1 at its end.',
    )

  const { compiled } = input
  if (compiled && compiled.mount !== 'wall')
    refuse('wrong_mount', `A ${kind}'s script uses mount 'wall'.`, { mount: compiled.mount })
  const [scriptedWidth, scriptedHeight] = compiled ? scriptedSize(compiled.manifest) : []
  const width = scriptedWidth ?? input.width ?? DEFAULTS[kind].width
  const height = scriptedHeight ?? input.height ?? DEFAULTS[kind].height
  const wallLength = lengthOf(wall)
  if (wallLength < width)
    refuse(
      'wall_too_short',
      `Wall ${wallId} is ${metres(wallLength)} long, too short for a ${metres(width)} ${kind}.`,
      { wallId, wallLength, width },
    )

  const rawX = along * wallLength
  const sillHeight = input.sillHeight ?? DEFAULTS.window.sillHeight
  const rawY = kind === 'door' ? height / 2 : sillHeight + height / 2
  const { clampedX, clampedY } =
    kind === 'door'
      ? clampDoorToWall(wall, rawX, width, height)
      : clampWindowToWall(wall, rawX, rawY, width, height, nodes as Record<AnyNodeId, AnyNode>)

  if (!input.force) {
    const blocking = findWallChildOverlap(wallId, nodes, clampedX, clampedY, width, height)
    if (blocking) {
      const span =
        blocking.type === 'item'
          ? getScaledDimensions(blocking as ItemNode)[0]
          : (blocking as { width: number }).width
      const center = (blocking as { position: [number, number, number] }).position[0]
      refuse(
        'opening_overlap',
        `A ${metres(width)} ${kind} at ${metres(clampedX)} on wall ${wallId} would overlap ${blocking.type} ${blocking.id} (${metres(center - span / 2)}–${metres(center + span / 2)}). Move it along the wall, or, if the person asked for the overlap, pass force, like holding Alt in the editor.`,
        { wallId, blockingId: blocking.id },
      )
    }
  }

  const levelId = wall.parentId
  const siblings = Object.values(nodes).filter((node) => {
    if (node.type !== kind) return false
    const parent = node.parentId ? nodes[node.parentId] : undefined
    return parent?.parentId === levelId
  }).length
  const base = {
    name: `${kind === 'door' ? 'Door' : 'Window'} ${siblings + 1}`,
    position: [clampedX, clampedY, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    wallId,
    parentId: wallId,
    width,
    height,
    ...(input.openingShape ? { openingShape: input.openingShape } : {}),
    ...(input.archHeight === undefined ? {} : { archHeight: Math.min(input.archHeight, height) }),
    ...(input.cornerRadius === undefined ? {} : { cornerRadius: input.cornerRadius }),
    ...(compiled ? { source: scriptSource(compiled) } : {}),
  }
  const node =
    kind === 'door'
      ? DoorNode.parse({
          ...base,
          ...doorFacing(wall),
          hingesSide: input.hingesSide ?? 'left',
          swingDirection: input.swingDirection ?? 'inward',
          ...getDoorStyleOverrides(input.style as DoorStyle | undefined),
          ...(input.doorType ? { doorType: input.doorType } : {}),
          ...(input.openingKind ? { openingKind: input.openingKind } : {}),
        })
      : WindowNode.parse({
          ...base,
          ...getWindowStyleOverrides(input.style as WindowStyle | undefined),
          ...(input.windowType ? { windowType: input.windowType } : {}),
          ...(input.columns ? { columnRatios: equalRatios(input.columns) } : {}),
          ...(input.rows ? { rowRatios: equalRatios(input.rows) } : {}),
        })

  return {
    node,
    wallId,
    localX: clampedX,
    t: along,
    wallLength,
    clamped: Math.abs(clampedX - rawX) > 1e-9 || Math.abs(clampedY - rawY) > 1e-9,
    ...(kind === 'window' ? { sillHeight: clampedY - height / 2 } : {}),
  }
}
