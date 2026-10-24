import {
  type AnyNode,
  type AnyNodeId,
  isDerivedNode,
  type LevelNode,
  nodeRegistry,
  type RevealConfig,
  type RevealPlanPoint,
  type RevealStyle,
  type SceneCommit,
} from '@pascal-app/core'
import type { RevealCandidate } from './reveal-schedule'
import type { PlayedStyle } from './reveal-wipe'

/**
 * How much of the construction plays. `off` shows a build at once; `simple`
 * keeps the scattered order with only `rise` and `scale`; `full` adds the
 * falls, settles, cuts, assembled roofs and the dust. `framing` plays the
 * same motions on the lazy, nested schedule (floor by floor, room by room,
 * piece by piece; `planLazyReveal`), overdone a little, and plugins that stage
 * their own members (the framing) read it and play them in the prerolls.
 */
export type ConstructionRevealLevel = 'off' | 'simple' | 'full' | 'framing'

/** A candidate; for an assembled node's part, also the node it assembles. */
export type StagedCandidate = RevealCandidate & { host?: string }

/** A roof piece lifts this share of its drop before it falls: a hair, 20 cm of 4 m. */
export const PART_LEAD = 0.05

/** `simple` keeps the stagger with only the two slice-one motions. */
export function styleAt(style: RevealStyle, at: ConstructionRevealLevel): PlayedStyle {
  // Framing lays a roof's covering over its frame in place; Full drops the whole roof.
  if (at === 'framing') return style === 'assemble' ? 'cover' : style
  if (at !== 'simple' || style === 'rise') return style
  return 'scale'
}

/** Kinds that hold the others: staging one would unmount everything under it. */
export const CONTAINERS: ReadonlySet<string> = new Set(['site', 'building', 'level'])

/**
 * The reveal a new node of a kind that declares none comes in with, so nothing a build adds pops in
 * at once: by where it stands (on an assembled node such as a roof, it falls onto it) and what it is. Null for the containers,
 * the annotations and the kinds that draw nothing.
 */
function defaultReveal(node: AnyNode, nodes: Record<AnyNodeId, AnyNode>): RevealConfig | null {
  const definition = nodeRegistry.get(node.type)
  if (!definition || CONTAINERS.has(node.type)) return null
  if (definition.category === 'analysis' || !(definition.renderer || definition.geometry))
    return null
  let parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  for (let guard = 0; parent && guard < 32; guard += 1) {
    if (nodeRegistry.get(parent.type)?.capabilities?.reveal?.style === 'assemble')
      return { phase: 'roof', style: 'drop', height: 2 }
    if (parent.type === 'level') break
    parent = parent.parentId ? nodes[parent.parentId as AnyNodeId] : undefined
  }
  switch (definition.category) {
    case 'structure':
      return { phase: 'structure', style: 'scale' }
    case 'utility':
      return { phase: 'openings', style: 'scale' }
    case 'site':
      return { phase: 'foundation', style: 'scale' }
    default:
      return { phase: 'furnishing', style: 'drop', height: 0.3 }
  }
}

/** Whether `node` comes in with a new host the commit stages (it is drawn inside it), not on its own. */
function ridesWithHost(
  node: AnyNode,
  before: SceneCommit['before'],
  current: SceneCommit['current'],
) {
  const parent = node.parentId ? current.nodes[node.parentId as AnyNodeId] : undefined
  return Boolean(parent && !CONTAINERS.has(parent.type) && !before.nodes[parent.id as AnyNodeId])
}

/** What a node declares and where it stands: its candidate, or null for a kind that declares no reveal. */
function candidateOf(
  node: AnyNode,
  nodes: Record<AnyNodeId, AnyNode>,
  at: ConstructionRevealLevel,
  source: string | null,
  seq: number,
  fallback = false,
): StagedCandidate | null {
  const reveal =
    nodeRegistry.get(node.type)?.capabilities?.reveal ??
    (fallback ? defaultReveal(node, nodes) : null)
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
 * assembles. A new node of a kind that declares none comes in with a default
 * reveal when what holds it was already there (under a new host, it comes in
 * with the host). `seq` counts on from `firstSeq` in arrival order. Each
 * candidate carries its room and its place in it (`layoutRevealCandidates`).
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
    const candidate =
      node &&
      candidateOf(
        node,
        current.nodes,
        at,
        author ?? null,
        seq,
        !ridesWithHost(node, before, current),
      )
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
  layoutRevealCandidates(candidates, current.nodes)
  return candidates
}

type Pt = RevealPlanPoint

const isPt = (value: unknown): value is Pt =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number'

function polygonOf(node: AnyNode): readonly Pt[] | null {
  const polygon = (node as { polygon?: unknown }).polygon
  return Array.isArray(polygon) && polygon.length >= 3 && polygon.every(isPt) ? polygon : null
}

/** The room a node outlines, as its kind declares it (`capabilities.revealLayout.room`). */
function roomOf(node: AnyNode): readonly Pt[] | null {
  const polygon = nodeRegistry.get(node.type)?.capabilities?.revealLayout?.room?.(node)
  return polygon && polygon.length >= 3 && polygon.every(isPt) ? polygon : null
}

/** The line a node bounds rooms along, as its kind declares it (`capabilities.revealLayout.line`). */
function lineOf(node: AnyNode): readonly [Pt, Pt] | null {
  const line = nodeRegistry.get(node.type)?.capabilities?.revealLayout?.line?.(node)
  return line && isPt(line[0]) && isPt(line[1]) ? line : null
}

const middleOf = ([start, end]: readonly [Pt, Pt]): Pt => [
  (start[0] + end[0]) / 2,
  (start[1] + end[1]) / 2,
]

function centroidOf(polygon: readonly Pt[]): Pt {
  let x = 0
  let z = 0
  for (const [px, pz] of polygon) {
    x += px
    z += pz
  }
  return [x / polygon.length, z / polygon.length]
}

function areaOf(polygon: readonly Pt[]): number {
  let twice = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const [x0, z0] = polygon[index]!
    const [x1, z1] = polygon[(index + 1) % polygon.length]!
    twice += x0 * z1 - x1 * z0
  }
  return Math.abs(twice) / 2
}

function inside([x, z]: Pt, polygon: readonly Pt[]): boolean {
  let within = false
  for (let index = 0, last = polygon.length - 1; index < polygon.length; last = index++) {
    const [xi, zi] = polygon[index]!
    const [xj, zj] = polygon[last]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within
  }
  return within
}

/** Where a node stands in its level's plan: a line's middle, a polygon's centre, a placed node's spot. */
function planPointOf(node: AnyNode): Pt | null {
  const line = lineOf(node)
  if (line) return middleOf(line)
  const { start, end, position } = node as { start?: unknown; end?: unknown; position?: unknown }
  if (isPt(start) && isPt(end)) return middleOf([start, end])
  const polygon = polygonOf(node)
  if (polygon) return centroidOf(polygon)
  if (Array.isArray(position) && typeof position[0] === 'number' && typeof position[2] === 'number')
    return [position[0], position[2]]
  return null
}

/** The node right under the level that `id` stands in (itself, or the host it hangs on). */
function standingOf(id: string, nodes: Record<AnyNodeId, AnyNode>): AnyNode | null {
  let node = nodes[id as AnyNodeId]
  for (let guard = 0; node && guard < 32; guard += 1) {
    const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    if (!parent || parent.type === 'level') return node
    node = parent
  }
  return null
}

/** Walls a run holds before the next run of the same outline starts beside it. */
const WALLS_PER_RUN = 6
/** Wall ends closer than this (m) meet. */
const MEETS_M = 0.05

/**
 * Gives each candidate its room for the lazy schedule: the room it stands in (a node on a line, the
 * room on either side of its middle), else, for a node on a line, a run of the lines it meets end to
 * end (`capabilities.revealLayout`); its room's
 * sweep across the floor; and its place in the room (around the room's centre, or along the run).
 * What stands in no room keeps none: it belongs to the floor.
 */
export function layoutRevealCandidates(
  candidates: StagedCandidate[],
  nodes: Record<AnyNodeId, AnyNode>,
): void {
  const zonesByLevel = new Map<string, { id: string; polygon: readonly Pt[]; centre: Pt }[]>()
  const zonesOf = (levelId: string) => {
    let zones = zonesByLevel.get(levelId)
    if (zones) return zones
    zones = []
    const level = nodes[levelId as AnyNodeId] as (AnyNode & { children?: unknown[] }) | undefined
    for (const childId of level?.children ?? []) {
      const child = typeof childId === 'string' ? nodes[childId as AnyNodeId] : undefined
      const polygon = child ? roomOf(child) : null
      if (child && polygon) zones.push({ id: child.id, polygon, centre: centroidOf(polygon) })
    }
    zones.sort((left, right) => areaOf(left.polygon) - areaOf(right.polygon))
    zonesByLevel.set(levelId, zones)
    return zones
  }
  const turnAround = (centre: Pt, point: Pt) => {
    const angle = Math.atan2(point[1] - centre[1], point[0] - centre[0])
    return angle < 0 ? angle + 2 * Math.PI : angle
  }
  // Lines in no room, by level: they make runs; what they host follows them.
  const loose = new Map<string, { candidate: StagedCandidate; line: readonly [Pt, Pt] }[]>()
  const onLooseWalls: { candidate: StagedCandidate; wallId: string; point: Pt }[] = []
  for (const candidate of candidates) {
    if (!candidate.levelId) continue
    const standing = standingOf(candidate.host ?? candidate.id, nodes)
    const point = standing && planPointOf(standing)
    if (!(standing && point)) continue
    const zones = zonesOf(candidate.levelId)
    const line = lineOf(standing)
    let probes: Pt[] = [point]
    if (line) {
      const [start, end] = line
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
      const nx = -(end[1] - start[1]) / length
      const nz = (end[0] - start[0]) / length
      probes = [
        [point[0] + nx * 0.3, point[1] + nz * 0.3],
        [point[0] - nx * 0.3, point[1] - nz * 0.3],
      ]
    }
    const zone = zones.find((candidateZone) =>
      probes.some((probe) => inside(probe, candidateZone.polygon)),
    )
    if (zone) {
      candidate.cluster = zone.id
      candidate.sweep = zone.centre[0] + zone.centre[1]
      candidate.order = turnAround(zone.centre, point)
      continue
    }
    if (line && standing.id === candidate.id) {
      const list = loose.get(candidate.levelId) ?? []
      list.push({ candidate, line })
      loose.set(candidate.levelId, list)
      continue
    }
    if (line) onLooseWalls.push({ candidate, wallId: standing.id, point })
    candidate.order = point[0] + point[1]
  }
  for (const [levelId, walls] of loose) layoutRuns(levelId, walls)
  if (onLooseWalls.length === 0) return
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  for (const { candidate, wallId } of onLooseWalls) {
    const wall = byId.get(wallId)
    if (!wall?.cluster) continue
    candidate.cluster = wall.cluster
    candidate.sweep = wall.sweep
    candidate.order = wall.order
  }
}

/** Lines in no room: the lines that meet end to end make an outline, cut in runs along it. */
function layoutRuns(
  levelId: string,
  walls: { candidate: StagedCandidate; line: readonly [Pt, Pt] }[],
) {
  const key = ([x, z]: Pt) => `${Math.round(x / MEETS_M)}:${Math.round(z / MEETS_M)}`
  const byEnd = new Map<string, number[]>()
  const ends = walls.map(({ line: [start, end] }) => [key(start), key(end)] as const)
  ends.forEach((pair, index) => {
    for (const end of pair) byEnd.set(end, [...(byEnd.get(end) ?? []), index])
  })
  const sweepOf = (index: number) => {
    const [x, z] = middleOf(walls[index]!.line)
    return x + z
  }
  const meeting = (index: number) =>
    ends[index]!.flatMap((end) => byEnd.get(end) ?? []).filter((next) => next !== index)
  const seen = new Set<number>()
  const starts = walls
    .map((_, index) => index)
    .sort((left, right) => sweepOf(left) - sweepOf(right))
  let outline = 0
  for (const first of starts) {
    if (seen.has(first)) continue
    // An open chain is walked from one of its free ends, a closed outline from its first wall in
    // the sweep: wall to the wall it meets, so each run is one stretch of the outline.
    const component = new Set([first])
    for (const index of component) for (const next of meeting(index)) component.add(next)
    const begin =
      [...component]
        .filter((index) => ends[index]!.some((end) => byEnd.get(end)?.length === 1))
        .sort((left, right) => sweepOf(left) - sweepOf(right))[0] ?? first
    const order: number[] = []
    const stack = [begin]
    while (stack.length > 0) {
      const index = stack.pop()!
      if (seen.has(index)) continue
      seen.add(index)
      order.push(index)
      stack.push(...meeting(index).reverse())
    }
    order.forEach((index, rank) => {
      const run = Math.floor(rank / WALLS_PER_RUN)
      const candidate = walls[index]!.candidate
      candidate.cluster = `${levelId}:run:${outline}:${run}`
      candidate.sweep = sweepOf(order[run * WALLS_PER_RUN]!)
      candidate.order = rank
    })
    outline += 1
  }
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

/**
 * A piece changed by a commit. `from` is where a moved piece stood when it can glide from there, else
 * null; `edited` marks a piece whose picture was edited (a wall bent, a slab resized), which plays its
 * reveal again, quickly (`commitEditCandidates`).
 */
export type ChangeCandidate = StagedCandidate & { from: Placement | null; edited?: true }

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
 * room's furniture), as the build would have staged it: by what its kind declares, or the default
 * reveal a kind that declares none came in with. What stands in a host that goes (a segment of a
 * stair, a part of a pool) goes with it; an assembled node (a roof) goes whole, not part by part.
 */
export function nodeRevealCandidates(
  ids: Iterable<string>,
  nodes: Record<AnyNodeId, AnyNode>,
  at: ConstructionRevealLevel,
): RevealCandidate[] {
  const asked = new Set(ids)
  const seen = new Set<string>()
  const candidates: RevealCandidate[] = []
  const visit = (id: string, guard = 0) => {
    const node = nodes[id as AnyNodeId]
    if (!node || seen.has(id) || guard > 64) return
    seen.add(id)
    const host = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    const goesWithHost = Boolean(
      host && !CONTAINERS.has(host.type) && (asked.has(host.id) || seen.has(host.id)),
    )
    const candidate = candidateOf(node, nodes, at, null, candidates.length, !goesWithHost)
    if (candidate) candidates.push(candidate)
    // An assembled or covered node's parts are not staged on their own.
    if (candidate?.style === 'assemble' || candidate?.style === 'cover') return
    for (const childId of (node as AnyNode & { children?: unknown[] }).children ?? []) {
      if (typeof childId === 'string') visit(childId, guard + 1)
    }
  }
  for (const id of asked) visit(id)
  return candidates
}

/** How an edited node plays again: a quick re-rise or re-scale, never a fall from a height. */
const EDIT_STYLE: Record<PlayedStyle, RevealStyle> = {
  rise: 'rise',
  scale: 'scale',
  settle: 'settle',
  drop: 'scale',
  cut: 'scale',
  assemble: 'scale',
  cover: 'scale',
}

const sameValue = (was: unknown, now: unknown) =>
  Object.is(was, now) || JSON.stringify(was) === JSON.stringify(now)

/**
 * What `commit` edits: each node already there whose kind lists `capabilities.revealOnEdit` and one of
 * those fields (the ones that make its picture) changed. A change to any other field stays instant, and
 * so does what the structure reconciler derived from an edit (`derivedWrites`: the plates and ceilings it
 * owns, the fields it wrote on a node): a wall moved does not make its room's floor rise again.
 */
export function commitEditCandidates(
  { before, current, author, derivedWrites }: SceneCommit,
  at: ConstructionRevealLevel,
  firstSeq = 0,
): ChangeCandidate[] {
  const candidates: ChangeCandidate[] = []
  let seq = firstSeq
  for (const id in current.nodes) {
    const was = before.nodes[id as AnyNodeId]
    const node = current.nodes[id as AnyNodeId]
    const derived = derivedWrites?.get(id as AnyNodeId)
    if (!(was && node) || was === node || derived === 'all' || isDerivedNode(node)) continue
    const fields = nodeRegistry.get(node.type)?.capabilities?.revealOnEdit
    const edited = fields?.some(
      (field) =>
        !derived?.has(field) &&
        !sameValue(was[field as keyof AnyNode], node[field as keyof AnyNode]),
    )
    if (!edited) continue
    const candidate = candidateOf(node, current.nodes, at, author ?? null, seq, true)
    if (!candidate) continue
    seq += 1
    const style = EDIT_STYLE[candidate.style]
    candidates.push({
      ...candidate,
      style,
      height: style === candidate.style ? candidate.height : 0,
      from: null,
      edited: true,
    })
  }
  return candidates
}

/**
 * What `commit` deletes that the picture can play out: each node that was there and is gone whose kind
 * stages a reveal, as it was staged when built (a node standing in a host that goes with it goes with
 * its host). Derived construction the reconciler retires is not a deletion the person or the agent made.
 */
export function commitDeleteCandidates(
  { before, current, author, derivedWrites }: SceneCommit,
  at: ConstructionRevealLevel,
  firstSeq = 0,
): StagedCandidate[] {
  const candidates: StagedCandidate[] = []
  let seq = firstSeq
  // A plate or a ceiling the reconciler owns goes with its room: it plays when the commit takes a
  // wall or a room off its level, and not when the reconciler merely derives it anew.
  const goingLevels = new Set<string>()
  for (const id in before.nodes) {
    const node = before.nodes[id as AnyNodeId]
    if (current.nodes[id as AnyNodeId] || !node?.parentId) continue
    if (nodeRegistry.get(node.type)?.capabilities?.revealLayout) goingLevels.add(node.parentId)
  }
  for (const id in before.nodes) {
    if (current.nodes[id as AnyNodeId]) continue
    const node = before.nodes[id as AnyNodeId]
    if (!node) continue
    if (isDerivedNode(node)) {
      if (!(node.parentId && goingLevels.has(node.parentId))) continue
    } else if (derivedWrites?.get(id as AnyNodeId) === 'all') continue
    const host = node.parentId ? before.nodes[node.parentId as AnyNodeId] : undefined
    const goesWithHost = Boolean(
      host && !CONTAINERS.has(host.type) && !current.nodes[host.id as AnyNodeId],
    )
    const candidate = candidateOf(node, before.nodes, at, author ?? null, seq, !goesWithHost)
    if (!candidate) continue
    seq += 1
    candidates.push(candidate)
  }
  return candidates
}
