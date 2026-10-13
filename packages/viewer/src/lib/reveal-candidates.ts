import {
  type AnyNode,
  type AnyNodeId,
  type LevelNode,
  nodeRegistry,
  type RevealStyle,
  type SceneCommit,
} from '@pascal-app/core'
import type { RevealCandidate } from './reveal-schedule'

/**
 * How much of the construction plays. `off` shows a build at once; `simple`
 * keeps the scattered order with only `rise` and `scale`; `full` adds the
 * falls, settles, cuts, assembled roofs and the dust. `framing` is `full` in
 * the viewer: plugins that stage their own members (the framing) read it.
 */
export type ConstructionRevealLevel = 'off' | 'simple' | 'full' | 'framing'

/** A candidate; for an assembled node's part, also the node it assembles. */
export type StagedCandidate = RevealCandidate & { host?: string }

/** A roof piece lifts this share of its drop before it falls: a hair, 20 cm of 4 m. */
export const PART_LEAD = 0.05

/** `simple` keeps the stagger with only the two slice-one motions. */
export function styleAt(style: RevealStyle, at: ConstructionRevealLevel): RevealStyle {
  if (at !== 'simple' || style === 'rise') return style
  return 'scale'
}

/** What a node declares and where it stands: its candidate, or null for a kind that declares no reveal. */
function candidateOf(
  node: AnyNode,
  nodes: Record<AnyNodeId, AnyNode>,
  at: ConstructionRevealLevel,
  source: string | null,
  seq: number,
): StagedCandidate | null {
  const reveal = nodeRegistry.get(node.type)?.capabilities?.reveal
  if (!reveal) return null
  let depth = 0
  let levelId: string | null = null
  let levelIndex = Number.MIN_SAFE_INTEGER
  let parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  while (parent && depth < 32) {
    depth += 1
    if (!levelId && parent.type === 'level') {
      levelId = parent.id
      levelIndex = (parent as LevelNode).level
    }
    parent = parent.parentId ? nodes[parent.parentId as AnyNodeId] : undefined
  }
  const style = styleAt(reveal.style, at)
  const height = 'height' in reveal && style === reveal.style ? reveal.height : 0
  return {
    id: node.id,
    phase: reveal.phase,
    levelId,
    levelIndex,
    source,
    style,
    height,
    depth,
    seq,
  }
}

/**
 * What `commit` stages at `at`: each node it creates whose kind declares a
 * reveal, and the new parts (children declaring none) of each one that
 * assembles. `seq` counts on from `firstSeq` in arrival order.
 */
export function commitRevealCandidates(
  { before, current, author }: SceneCommit,
  at: ConstructionRevealLevel,
  firstSeq = 0,
): StagedCandidate[] {
  const candidates: StagedCandidate[] = []
  let seq = firstSeq
  for (const id in current.nodes) {
    if (before.nodes[id as AnyNodeId]) continue
    const node = current.nodes[id as AnyNodeId]
    const candidate = node && candidateOf(node, current.nodes, at, author ?? null, seq)
    if (!(node && candidate)) continue
    seq += 1
    candidates.push(candidate)
    if (candidate.style !== 'assemble') continue
    // Its new children that declare no reveal of their own are its parts: each drops in.
    for (const partId of (node as AnyNode & { children?: unknown[] }).children ?? []) {
      if (typeof partId !== 'string' || before.nodes[partId as AnyNodeId]) continue
      const part = current.nodes[partId as AnyNodeId]
      if (!part || nodeRegistry.get(part.type)?.capabilities?.reveal) continue
      candidates.push({
        id: partId,
        phase: candidate.phase,
        levelId: candidate.levelId,
        levelIndex: candidate.levelIndex,
        source: candidate.source,
        style: 'drop',
        height: candidate.height,
        depth: candidate.depth + 1,
        seq: seq++,
        host: id,
        lead: PART_LEAD,
      })
    }
  }
  return candidates
}

/** Moved less than this (metres, radians) and a piece is where it was. */
const PLACED_EPSILON = 1e-4

function placedDifferently(was: unknown, now: unknown): boolean {
  if (typeof was === 'number' && typeof now === 'number')
    return Math.abs(was - now) > PLACED_EPSILON
  if (Array.isArray(was) && Array.isArray(now)) {
    return (
      was.length !== now.length || was.some((value, index) => placedDifferently(value, now[index]))
    )
  }
  return was !== now
}

/** Where a piece stood in its level: its position, and its turn about the vertical. */
export type Placement = { position: [number, number, number]; yaw: number }

/** A piece moved by a commit; `from` is where it stood when it can glide from there, else null. */
export type ChangeCandidate = StagedCandidate & { from: Placement | null }

/** Moved less than this (metres, radians) and a piece does not glide: it is where it was. */
const GLIDES_FROM = 0.02

function placementOf(node: AnyNode): Placement | null {
  const { position, rotation } = node as unknown as { position?: unknown; rotation?: unknown }
  if (!(Array.isArray(position) && position.length === 3)) return null
  if (!position.every((value) => typeof value === 'number')) return null
  const yaw = Array.isArray(rotation) ? rotation[1] : rotation
  return {
    position: position as [number, number, number],
    yaw: typeof yaw === 'number' ? yaw : 0,
  }
}

/** The place a piece glides from: standing in the same level both times, and moved enough to see. */
function glidesFrom(
  was: AnyNode,
  node: AnyNode,
  nodes: Record<AnyNodeId, AnyNode>,
): Placement | null {
  if (was.parentId !== node.parentId || nodes[node.parentId as AnyNodeId]?.type !== 'level')
    return null
  const from = placementOf(was)
  const to = placementOf(node)
  if (!(from && to)) return null
  const travelled = Math.hypot(
    from.position[0] - to.position[0],
    from.position[1] - to.position[1],
    from.position[2] - to.position[2],
  )
  return travelled > GLIDES_FROM || Math.abs(from.yaw - to.yaw) > GLIDES_FROM ? from : null
}

/**
 * What `commit` moves: each piece of furniture it finds already there that is placed differently
 * (another position, turn or parent). Furniture only, for now: walls and openings move with the
 * rooms and walls that hold them.
 */
export function commitChangeCandidates(
  { before, current, author }: SceneCommit,
  at: ConstructionRevealLevel,
  firstSeq = 0,
): ChangeCandidate[] {
  const candidates: ChangeCandidate[] = []
  let seq = firstSeq
  for (const id in current.nodes) {
    const was = before.nodes[id as AnyNodeId]
    const node = current.nodes[id as AnyNodeId]
    if (!(was && node) || was === node) continue
    if (nodeRegistry.get(node.type)?.capabilities?.reveal?.phase !== 'furnishing') continue
    const placed = (value: AnyNode, key: string) =>
      (value as unknown as Record<string, unknown>)[key]
    const moved =
      node.parentId !== was.parentId ||
      ['position', 'rotation'].some((key) => placedDifferently(placed(was, key), placed(node, key)))
    if (!moved) continue
    const candidate = candidateOf(node, current.nodes, at, author ?? null, seq)
    if (!candidate) continue
    seq += 1
    candidates.push({ ...candidate, from: glidesFrom(was, node, current.nodes) })
  }
  return candidates
}

/**
 * What taking `ids` back reveals: each of them, and everything under them (a wall's openings, a
 * room's furniture), whose kind declares a reveal, as the build would have staged it. An
 * assembled node (a roof) goes whole, not part by part.
 */
export function nodeRevealCandidates(
  ids: Iterable<string>,
  nodes: Record<AnyNodeId, AnyNode>,
  at: ConstructionRevealLevel,
): RevealCandidate[] {
  const seen = new Set<string>()
  const candidates: RevealCandidate[] = []
  const visit = (id: string, guard = 0) => {
    const node = nodes[id as AnyNodeId]
    if (!node || seen.has(id) || guard > 64) return
    seen.add(id)
    const candidate = candidateOf(node, nodes, at, null, candidates.length)
    if (candidate) candidates.push(candidate)
    // An assembled node's parts are not staged on their own.
    if (candidate?.style === 'assemble') return
    for (const childId of (node as AnyNode & { children?: unknown[] }).children ?? []) {
      if (typeof childId === 'string') visit(childId, guard + 1)
    }
  }
  for (const id of ids) visit(id)
  return candidates
}
