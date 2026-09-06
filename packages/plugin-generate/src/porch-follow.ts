/**
 * The porch posts follow the stair (Steve, 2026-09-06: "if the person
 * adjusts the stair it moves the posts"). The generator seats one post each
 * side of the flight (porch.ts tags them `metadata.post.flank`); when the
 * stair of that entrance is moved ALONG the porch edge, the two flanking
 * posts slide the same distance so the flight still runs through the first
 * bay between them. A move into or out of the porch (square to the edge)
 * moves no post — the posts stand on the beam line whatever the flight does.
 *
 * Pure: nodes + the stair's previous transform → the column patches to apply.
 * The editor wires it to the scene store in index.ts.
 */

import { GENERATED_BY } from './build'

type N = Record<string, unknown>
type Nodes = Readonly<Record<string, N | undefined>>

export type FollowPatch = { id: string; position: [number, number, number] }

/** Two millimetres: a move shorter than this is a nudge, not a re-seat. */
const MIN_MOVE = 0.002

function porchMeta(node: N | undefined): { entrance?: string } | null {
  const meta = node?.metadata as N | undefined
  if (!meta || meta.generatedBy !== GENERATED_BY) return null
  const porch = meta.porch as N | undefined
  if (!porch || typeof porch !== 'object') return null
  return { entrance: typeof porch.entrance === 'string' ? porch.entrance : undefined }
}

function isFlankPost(node: N | undefined): boolean {
  if (node?.type !== 'column') return false
  const meta = node.metadata as N | undefined
  const post = meta?.post as N | undefined
  return post?.flank === true
}

function vec3(v: unknown): [number, number, number] | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
    ? (v as [number, number, number])
    : null
}

/**
 * The column patches that keep a generated entrance's flanking posts each
 * side of its stair after the stair moved from `previous`. Empty when the
 * stair is not a generated porch stair, did not move along the porch edge,
 * or has no flanking posts.
 */
export function stairFollowPatches(
  nodes: Nodes,
  stairId: string,
  previous: { position: [number, number, number] },
): FollowPatch[] {
  const stair = nodes[stairId]
  if (stair?.type !== 'stair') return []
  const porch = porchMeta(stair)
  if (!porch?.entrance) return []
  const now = vec3(stair.position)
  if (!now) return []
  const yaw = typeof stair.rotation === 'number' ? stair.rotation : 0
  // the stair's run climbs along its local +z = (sin yaw, cos yaw); the
  // porch edge runs along its local +x = (cos yaw, −sin yaw)
  const along: [number, number] = [Math.cos(yaw), -Math.sin(yaw)]
  const dx = now[0] - previous.position[0]
  const dz = now[2] - previous.position[2]
  const slide = dx * along[0] + dz * along[1]
  if (Math.abs(slide) < MIN_MOVE) return []
  const out: FollowPatch[] = []
  for (const node of Object.values(nodes)) {
    if (!isFlankPost(node)) continue
    if (node?.parentId !== stair.parentId) continue
    const meta = porchMeta(node)
    if (!meta || meta.entrance !== porch.entrance) continue
    const p = vec3(node?.position)
    if (!p) continue
    const round = (v: number) => Math.round(v * 1e4) / 1e4
    out.push({
      id: String(node?.id),
      position: [round(p[0] + along[0] * slide), p[1], round(p[2] + along[1] * slide)],
    })
  }
  return out
}
