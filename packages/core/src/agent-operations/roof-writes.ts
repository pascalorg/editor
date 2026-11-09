import { AgentRefusal, refuse } from '../agent-tools/refusal'
import { getLevelDisplayName } from '../lib/level-name'
import { type AnyNode, parseNode } from '../schema'
import {
  isRoofGeometry,
  isRoofLevel,
  isStoreyContent,
  liftRoofLevels,
  roofLevelOrderBreach,
  servesAsRoofLevel,
  storeyOf,
} from '../services/roof-level'
import { planRoofSeats } from '../services/roof-move'
import { applySceneWrites } from './apply-changes'
import type { NodeWrite, SceneNodes } from './types'

/**
 * The roof-level rule on writes that name every node and parent themselves (apply_patch,
 * update_node, a saved graph): a roof written on the storey whose walls carry it goes to the level
 * above, said in a note; what the rule cannot place is refused, naming what would work.
 */

const nameOf = (nodes: SceneNodes, id: string) => {
  const node = nodes[id]
  return node?.type === 'level' ? `${getLevelDisplayName(node)} (${id})` : id
}

function onRoofLevel(
  nodes: SceneNodes,
  levelId: string,
  what: string,
  details: Record<string, unknown> = {},
): AgentRefusal {
  const storeyId = storeyOf(nodes, levelId)
  return new AgentRefusal(
    'roof_level',
    `${nameOf(nodes, levelId)} is a roof level, not a storey: ${what} belongs on a storey${storeyId === levelId ? '' : `, such as ${nameOf(nodes, storeyId)}, the one it covers`}. Add a storey with add_level if the building needs one.`,
    { ...details, levelId, storeyId },
  )
}

/**
 * Storey content aimed at a level serving as its building's roof level: the refusal, naming the
 * storey it covers so one retry lands; null on a storey.
 */
export function roofLevelRefusal(
  nodes: SceneNodes,
  levelId: string,
  what: string,
): AgentRefusal | null {
  const level = nodes[levelId]
  return level?.type === 'level' && servesAsRoofLevel(nodes, level)
    ? onRoofLevel(nodes, levelId, what)
    : null
}

/** A level serving as its building's roof level holds roofs, not rooms: storey content is refused there. */
export function refuseRoofLevel(nodes: SceneNodes, levelId: string, what: string) {
  const refusal = roofLevelRefusal(nodes, levelId, what)
  if (refusal) throw refusal
}

const roleOf = (write: NodeWrite) =>
  write.op === 'create'
    ? (write.node.metadata as { role?: unknown } | undefined)?.role
    : write.op === 'update'
      ? (write.data.metadata as { role?: unknown } | undefined)?.role
      : undefined

/**
 * The rule on a write's operations, in their order, against the scene they write to: storey
 * content created or moved onto a roof level (`roof_level`), a walled level declared the roof level
 * (`roof_level_holds_storey`) and floor indexes putting a roof level under a storey
 * (`roof_level_on_top`) are refused, naming the operation's index. A storey created at or above a
 * roof level moves the roof levels up over it, and each roof the write puts on its walls' storey
 * is seated (`planRoofSeats`): both appended to `ops` as operations of their own, so every index
 * stays the model's. Returns a note per change.
 */
export function seatWrittenRoofs(ops: NodeWrite[], scene: SceneNodes): string[] {
  // Parsed as the store creates them, so a level written without `children` gets its list.
  const writes = ops.map((write) => {
    if (write.op !== 'create') return write
    const parsed = parseNode(write.node)
    return { ...write, node: parsed.success ? parsed.data : write.node }
  })
  const after = applySceneWrites(scene, writes)

  writes.forEach((write, index) => {
    const placed =
      write.op === 'create'
        ? {
            id: write.node.id,
            type: write.node.type,
            parentId: write.parentId ?? write.node.parentId,
            metadata: after[write.node.id]?.metadata,
          }
        : write.op === 'update' &&
            (typeof write.data.parentId === 'string' ||
              (isRoofGeometry(scene[write.id]) && !isRoofGeometry(after[write.id])))
          ? after[write.id]
          : null
    if (!placed?.parentId || !isStoreyContent(placed.type, placed.metadata)) return
    // A retained assembly's separately addressed children still belong to its level.
    let parentId = placed.parentId
    let retainedRoofAncestor = false
    const seen = new Set<string>()
    while (after[parentId]?.type === 'item' && !seen.has(parentId)) {
      seen.add(parentId)
      retainedRoofAncestor ||= isRoofGeometry(after[parentId])
      const next = after[parentId]?.parentId
      if (!next) break
      parentId = next
    }
    if (!retainedRoofAncestor) parentId = placed.parentId
    const prior = scene[parentId]
    const what = `a ${placed.type}`
    if (isRoofLevel(after[parentId]))
      throw onRoofLevel(after, parentId, what, { index, id: placed.id })
    if (prior?.type === 'level' && servesAsRoofLevel(scene, prior))
      throw onRoofLevel(scene, parentId, what, { index, id: placed.id })
  })

  writes.forEach((write, index) => {
    const id = write.op === 'create' ? write.node.id : write.op === 'update' ? write.id : null
    const level = id ? after[id] : undefined
    if (!id || roleOf(write) !== 'roof' || isRoofLevel(scene[id]) || level?.type !== 'level') return
    const held = [
      ...new Set(
        level.children
          .map((child) => after[child])
          .filter((child) => isStoreyContent(child?.type, child?.metadata))
          .map((child) => child!.type),
      ),
    ]
    if (held.length)
      refuse(
        'roof_level_holds_storey',
        `${nameOf(after, id)} holds ${held.map((type) => `a ${type}`).join(', ')}, a storey's content, so it cannot be declared the roof level: a roof level holds roofs only. create_roof puts a roof over a storey on the level the rule gives it.`,
        { index, id, levelId: id },
      )
  })

  const floors = new Map(
    writes.flatMap((write) =>
      write.op === 'update' &&
      typeof write.data.level === 'number' &&
      scene[write.id]?.type === 'level'
        ? [[write.id, write.data.level] as const]
        : [],
    ),
  )
  const breach = floors.size ? roofLevelOrderBreach(scene, floors) : null
  if (breach) {
    const index = writes.findIndex(
      (write) =>
        write.op === 'update' &&
        floors.has(write.id) &&
        (write.id === breach.roofId || write.id === breach.storeyId),
    )
    refuse(
      'roof_level_on_top',
      `This write puts ${nameOf(after, breach.roofId)}, the roof level, under the storey ${nameOf(after, breach.storeyId)}: a building's roof level stays above its storeys. Keep its floor index over theirs; a new storey goes under it (add_level).`,
      {
        index,
        id: (writes[index] as { id: string }).id,
        levelId: breach.roofId,
        storeyId: breach.storeyId,
      },
    )
  }

  const notes: string[] = []
  const appended: NodeWrite[] = []
  // A storey created at or above a roof level, or a roof level created at or under a storey: the
  // building's roof levels go up over its storeys.
  const buildings = new Set(
    writes.flatMap((write) =>
      write.op === 'create' && write.node.type === 'level' ? [after[write.node.id]?.parentId] : [],
    ),
  )
  for (const buildingId of buildings) {
    if (!buildingId) continue
    for (const { id, data } of liftRoofLevels(scene, after, buildingId)) {
      appended.push({ op: 'update', id, data })
      notes.push(
        `${nameOf(after, id)} moved up to floor index ${data.level}: a building's roof level stays above its storeys.`,
      )
    }
  }

  const seat = planRoofSeats(scene, applySceneWrites(after, appended))
  if (seat) {
    const moved = new Map(seat.changes.update.map(({ id, data }) => [id, data.parentId]))
    // A parent the write creates listing a roof the seat moves would list it twice.
    for (const write of ops) {
      if (write.op !== 'create') continue
      const children = (write.node as { children?: unknown }).children
      if (!Array.isArray(children)) continue
      const kept = children.filter((id) => {
        const to = moved.get(id)
        return to === undefined || to === write.node.id
      })
      if (kept.length !== children.length) write.node = { ...write.node, children: kept } as AnyNode
    }
    appended.push(
      ...seat.changes.create.map(({ node, parentId }) => ({
        op: 'create' as const,
        node,
        ...(parentId ? { parentId } : {}),
      })),
      ...seat.changes.update.map(({ id, data }) => ({ op: 'update' as const, id, data })),
    )
    notes.push(...seat.notes)
  }
  ops.push(...appended)
  return notes
}
