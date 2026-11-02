import { isFloorUnderlay } from '../../agent-operations/furniture-kind'
import { resolveLevelId } from '../../lib/node-ancestry'
import { area, intersection, type Ring } from '../../lib/polygon-boolean'
import type { DoorNode, ItemNode, WallNode, WindowNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import { getWallLocalFaceZ } from '../../systems/wall/wall-frame'
import { TOLERANCE_M, type UsageIssue } from './findings'
import { cm, nameOf, quote, unique } from './labels'
import {
  boxesMeet,
  isBed,
  isFoliage,
  isPiecePrism,
  itemText,
  narrowestExtent,
  ringBox,
  roomAt,
} from './pieces'
import type { Prism, UsageShapes } from './types'
import type { Nodes } from './walls'

/** How far in front of the glass a piece blocks the window: a curtain's depth (m). */
export const WINDOW_BLOCK_M = 0.15
/** And the strip beyond it, read as information (m). */
export const WINDOW_NEAR_M = 0.3
/** A piece blocks a window from this height above the sill: below it, a sideboard under the sill is fine (m). */
export const WINDOW_ABOVE_SILL_M = 0.3
/** Of the window's width, a piece must cover this share to block it. */
export const WINDOW_COVER = 0.25
/** A piece this deep in a curtain or blind envelope is in the curtains (m). */
export const ENVELOPE_M = 0.05

const MIN_AREA_M2 = 0.01
/** What is set at a window by design: a shower, a bath or a tub (its glass or rim is no curtain), a bedside piece or a lamp (its top is a shade, not a wall). */
const SET_AT_WINDOW =
  /shower|bath|(?:^|[^a-z])tub(?![a-z])|bedside|night ?stand|(?:^|[^a-z])lamp(?![a-z])/i
/** What hangs at a window: a free piece named for one is a window treatment that was never put on the window. */
const CURTAIN = /curtain|drape|blind|shutter|sheer|pelmet|valance/i
export const isSetAtWindow = (text: string): boolean => SET_AT_WINDOW.test(text)

type Frame = {
  wall: WallNode
  tx: number
  tz: number
  nx: number
  nz: number
  faceZ: number
  sign: 1 | -1
}

const point = (frame: Frame, along: number, out: number): [number, number] => {
  const [sx, sz] = frame.wall.start
  return [
    sx + frame.tx * along + frame.nx * (frame.faceZ + frame.sign * out),
    sz + frame.tz * along + frame.nz * (frame.faceZ + frame.sign * out),
  ]
}

function roomSides(wall: WallNode): Frame[] {
  const [sx, sz] = wall.start
  const [ex, ez] = wall.end
  const length = Math.hypot(ex - sx, ez - sz)
  if (length < 1e-6) return []
  const tx = (ex - sx) / length
  const tz = (ez - sz) / length
  const base = { wall, tx, tz, nx: -tz, nz: tx }
  const sides: Frame[] = []
  // the faces a wall calls exterior are not a room's: a partition (both faces interior) is judged on both
  if (wall.frontSide !== 'exterior')
    sides.push({ ...base, faceZ: getWallLocalFaceZ(wall, 'a'), sign: 1 })
  if (wall.backSide !== 'exterior')
    sides.push({ ...base, faceZ: getWallLocalFaceZ(wall, 'b'), sign: -1 })
  return sides
}

/**
 * What stands in front of an opening. A window: a piece whose top is at least 30 cm above its sill,
 * within 15 cm of the glass across a quarter of its width, blocks it (a low sideboard under the sill
 * does not); within 30 cm it is information, unless it covers the whole glass, its width and up to its head,
 * or is a curtain or blind that stands free (one hosted on the window is its treatment, read as its envelope); a piece 5 cm deep
 * in its curtain or blind envelope is in the curtains. A door's swing is read by `doorSwingIssues`.
 */
export function blockedOpeningIssues(
  nodes: Nodes,
  shapes: UsageShapes,
  /** A piece that is not in the scene (yet): only the windows it would stand in front of are read, on its level. */
  candidate?: { levelId: string; prisms: Prism[] },
): UsageIssue[] {
  const out: UsageIssue[] = []
  // a piece of several bands, or a window with two panes, is one finding: the worst reading of each pair
  const worst = new Map<string, { issue: UsageIssue; rank: number }>()
  const keep = (key: string, issue: UsageIssue, rank: number) => {
    const known = worst.get(key)
    if (!known || rank > known.rank) worst.set(key, { issue, rank })
  }
  const elevations = getLevelElevations(nodes as never)
  for (const level of shapes.levels) {
    if (candidate && level.levelId !== candidate.levelId) continue
    const baseY = elevations.get(level.levelId)?.baseY ?? 0
    const prisms = level.prisms.filter(
      (prism) =>
        !(nodes[prism.nodeId]?.type === 'item' && isFloorUnderlay(nodes[prism.nodeId] as ItemNode)),
    )
    const pieces = candidate
      ? candidate.prisms
      : prisms.filter((prism) => isPiecePrism(prism) && !isFoliage(nodes, prism.nodeId))
    const pieceBoxes = new Map<Prism, [number, number, number, number]>(
      pieces.map((prism) => [prism, ringBox(prism.outer)]),
    )
    for (const node of Object.values(nodes)) {
      if ((node.type !== 'window' && node.type !== 'door') || node.visible === false) continue
      const opening = node as WindowNode | DoorNode
      const wall = nodes[opening.parentId ?? ''] as WallNode | undefined
      if (wall?.type !== 'wall' || resolveLevelId(wall, nodes as never) !== level.levelId) continue
      const half = (opening.width ?? 0.9) / 2
      const along = opening.position[0]
      const frames = prisms.filter(
        (prism) =>
          prism.nodeId === opening.id &&
          (prism.kind === 'window-frame' || prism.kind === 'jamb' || prism.kind === 'door-head'),
      )
      const glazed = frames.filter((prism) => prism.kind !== 'sill')
      const head = frames.length ? Math.max(...frames.map((prism) => prism.z1)) : baseY + 2.1
      const sill =
        opening.type === 'door'
          ? baseY
          : glazed.length
            ? Math.min(...glazed.map((prism) => prism.z0))
            : baseY + opening.position[1] - (opening.height ?? 1.2) / 2
      for (const frame of roomSides(wall)) {
        const label = quote(nameOf(nodes, opening.id))
        const middle = point(frame, along, 0.4)
        const room = roomAt(nodes, level.levelId, middle)
        if (opening.type === 'window') {
          const zone: Ring = [
            point(frame, along - half, 0),
            point(frame, along + half, 0),
            point(frame, along + half, WINDOW_NEAR_M),
            point(frame, along - half, WINDOW_NEAR_M),
          ]
          const zoneBox = ringBox(zone)
          const envelopes = prisms.filter(
            (prism) => prism.kind === 'treatment' && prism.nodeId === opening.id,
          )
          for (const piece of pieces) {
            if (piece.z1 < sill + WINDOW_ABOVE_SILL_M || piece.z0 > head) continue
            if (piece.host?.wallId === wall.id) continue
            if (isSetAtWindow(itemText(nodes, piece.nodeId))) continue
            // a bed head against a window is a design choice, not a finding
            if (isBed(nodes[piece.nodeId])) continue
            if (!boxesMeet(pieceBoxes.get(piece)!, zoneBox)) continue
            const meet = intersection({ outer: piece.outer, holes: piece.holes }, zone)
            if (area(meet) < MIN_AREA_M2) continue
            let nearest = Number.POSITIVE_INFINITY
            let low = Number.POSITIVE_INFINITY
            let high = Number.NEGATIVE_INFINITY
            for (const part of meet)
              for (const [x, z] of part.outer) {
                const [sx, sz] = wall.start
                nearest = Math.min(
                  nearest,
                  ((x - sx) * frame.nx + (z - sz) * frame.nz - frame.faceZ) * frame.sign,
                )
                const u = (x - sx) * frame.tx + (z - sz) * frame.tz
                low = Math.min(low, u)
                high = Math.max(high, u)
              }
            const cover =
              Math.max(0, Math.min(high, along + half) - Math.max(low, along - half)) / (2 * half)
            if (cover < WINDOW_COVER) continue
            nearest = Math.max(0, nearest)
            const who = quote(nameOf(nodes, piece.nodeId))
            const tall = piece.z1 - sill >= WINDOW_ABOVE_SILL_M
            const warning = tall && nearest <= WINDOW_BLOCK_M
            // past a curtain's depth, a piece not hosted on the window still shuts it when it is a curtain or blind, or covers all of the glass (its width, and up to its head)
            const shuts =
              tall &&
              nearest > WINDOW_BLOCK_M &&
              (CURTAIN.test(itemText(nodes, piece.nodeId)) ||
                (cover >= 1 - TOLERANCE_M / (2 * half) && piece.z1 >= head - TOLERANCE_M))
            const deepIn = envelopes.reduce((deepest, envelope) => {
              if (Math.min(piece.z1, envelope.z1) - Math.max(piece.z0, envelope.z0) < 0.02)
                return deepest
              const inside = intersection(
                { outer: piece.outer, holes: piece.holes },
                { outer: envelope.outer, holes: envelope.holes },
              )
              return area(inside) < MIN_AREA_M2
                ? deepest
                : Math.max(deepest, narrowestExtent(inside))
            }, 0)
            const inCurtains = deepIn >= ENVELOPE_M
            const approximate =
              piece.shape === 'approx' ||
              (inCurtains && envelopes.some((e) => e.shape === 'approx'))
            keep(
              `${opening.id}|${frame.sign}|${piece.nodeId}`,
              {
                type: 'usage_opening_blocked',
                message: inCurtains
                  ? `${who} stands ${cm(deepIn)} deep in the curtains or blinds of ${label}${room ? ` in ${quote(room.name)}` : ''} (the window is covered over ${Math.round(cover * 100)} % of its width).`
                  : `${who} stands ${cm(nearest)} from the glass of ${label}${room ? ` in ${quote(room.name)}` : ''}, ${Math.round((piece.z1 - sill) * 100)} cm above its sill, over ${Math.round(cover * 100)} % of its width${shuts ? ', and is not hosted on the window' : ''}.`,
                severity: warning || shuts || inCurtains ? 'warning' : 'info',
                nodeIds: unique([room?.id, opening.id, piece.nodeId]),
                valueM: Math.round((inCurtains ? deepIn : nearest) * 1000) / 1000,
                thresholdM: inCurtains ? ENVELOPE_M : shuts ? WINDOW_NEAR_M : WINDOW_BLOCK_M,
                place: { room: room?.name ?? '', roomId: room?.id ?? level.levelId, at: middle },
                obstacles: [
                  {
                    nodeId: piece.nodeId,
                    name: nameOf(nodes, piece.nodeId),
                    kind: piece.kind,
                    shape: piece.shape,
                    movable: false,
                  },
                ],
                approximate,
              },
              (warning || shuts || inCurtains ? 100 : 0) + (inCurtains ? deepIn : 1 - nearest),
            )
          }
        }
      }
    }
  }
  out.push(...[...worst.values()].map(({ issue }) => issue))
  return out
}
