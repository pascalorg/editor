import type { CameraPose } from '../events/bus'
import { generateId } from './base'
import type { AnyNodeId } from './types'

export type CommentId = `comment_${string}`
export type CommentReplyId = `comment-reply_${string}`

/**
 * Where a thread hangs in the model.
 *
 * `position` is always recorded, so the 2D floorplan and the 3D canvas draw the
 * pin from the same number without either needing the other's machinery — the
 * floorplan has no scene registry to resolve a node through, and a session that
 * opens in 2D never mounts the R3F tree at all.
 *
 * `nodeId` + `offset` are the *follow* half, filled when the pin was dropped on
 * an element: the pin tracks that element as long as the kind exposes a plain
 * `position`. Kinds that don't (a wall is `start`/`end`) keep the thread and
 * fall back to `position`, which is stale after a move but never wrong about
 * which element the thread is against.
 */
export type CommentAnchor = {
  position: [number, number, number]
  nodeId?: AnyNodeId
  offset?: [number, number, number]
}

/**
 * Who wrote a comment. `id` is absent for anonymous share-link visitors, who
 * only ever supply a display name — accounts are the Cloud & Scale milestone,
 * and comments must not block on them.
 */
export type CommentAuthor = {
  id?: string
  name: string
}

export type CommentReply = {
  id: CommentReplyId
  author: CommentAuthor
  body: string
  /** ISO 8601. Written by the client, so treat it as display data, not an order key across authors. */
  createdAt: string
  editedAt?: string
}

/**
 * A pinned discussion thread. Scene-side state like `collections` and
 * `savedViews` — persisted with the document but deliberately **not a node**:
 * putting it in `AnyNode` would drag it into the undo history and the scene
 * graph's spatial hierarchy, neither of which a comment belongs in.
 *
 * Anything added here has to travel across all five persistence boundaries
 * (save, load, clone, fork, live sync).
 */
export type CommentThread = {
  id: CommentId
  anchor: CommentAnchor
  author: CommentAuthor
  body: string
  createdAt: string
  editedAt?: string
  resolved?: boolean
  resolvedAt?: string
  resolvedBy?: CommentAuthor
  /**
   * Camera at the moment the pin was dropped, so clicking the thread restores
   * the framing the author was describing. Absent when the thread was created
   * from the 2D view, which has no camera to capture.
   */
  camera?: CameraPose
  /**
   * The level the pin reads as belonging to. The floorplan draws one level at a
   * time and has no way to derive this from a world position alone once storeys
   * overlap.
   */
  levelId?: AnyNodeId
  replies: CommentReply[]
}

export const generateCommentId = (): CommentId => generateId('comment')
export const generateCommentReplyId = (): CommentReplyId => generateId('comment-reply')

/** Threads oldest-first. Ties fall back to id so the order is total. */
export function sortCommentThreads(comments: Record<CommentId, CommentThread>): CommentThread[] {
  return Object.values(comments).sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  )
}

/**
 * World position of a thread's pin. Follows the anchored node when the caller
 * can resolve its origin, and falls back to the position recorded at drop time
 * otherwise — a node that was deleted, or a kind with no plain `position`.
 */
export function resolveCommentAnchorPosition(
  anchor: CommentAnchor,
  nodePosition: (id: AnyNodeId) => [number, number, number] | null,
): [number, number, number] {
  if (!(anchor.nodeId && anchor.offset)) return anchor.position
  const base = nodePosition(anchor.nodeId)
  if (!base) return anchor.position
  const [dx, dy, dz] = anchor.offset
  return [base[0] + dx, base[1] + dy, base[2] + dz]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTriple = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n))

function normalizeAuthor(value: unknown): CommentAuthor {
  if (!isRecord(value)) return { name: 'Unknown' }
  const name = typeof value.name === 'string' && value.name.trim() ? value.name : 'Unknown'
  const author: CommentAuthor = { name }
  if (typeof value.id === 'string' && value.id) author.id = value.id
  return author
}

function normalizeAnchor(value: unknown): CommentAnchor | null {
  if (!isRecord(value)) return null
  if (!isTriple(value.position)) return null
  const anchor: CommentAnchor = { position: value.position }
  if (typeof value.nodeId === 'string' && value.nodeId) anchor.nodeId = value.nodeId as AnyNodeId
  if (isTriple(value.offset)) anchor.offset = value.offset
  return anchor
}

function normalizeCameraPose(value: unknown): CameraPose | null {
  if (!isRecord(value)) return null
  const { position, target, projection } = value
  if (!(isTriple(position) && isTriple(target))) return null
  if (projection !== 'perspective' && projection !== 'orthographic') return null

  const pose: CameraPose = { position, target, projection }
  if (typeof value.viewWidth === 'number' && Number.isFinite(value.viewWidth)) {
    pose.viewWidth = value.viewWidth
  }
  if (typeof value.fov === 'number' && Number.isFinite(value.fov)) pose.fov = value.fov
  return pose
}

function normalizeReplies(value: unknown): CommentReply[] {
  if (!Array.isArray(value)) return []
  const replies: CommentReply[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    if (typeof raw.body !== 'string') continue
    const reply: CommentReply = {
      id: (typeof raw.id === 'string' && raw.id
        ? raw.id
        : generateCommentReplyId()) as CommentReplyId,
      author: normalizeAuthor(raw.author),
      body: raw.body,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    }
    if (typeof raw.editedAt === 'string') reply.editedAt = raw.editedAt
    replies.push(reply)
  }
  return replies
}

/**
 * Coerce a persisted `comments` bag into shape, dropping threads that cannot be
 * placed. Runs on every load: a thread whose anchor is malformed would render a
 * pin at `NaN` and take the whole overlay down with it.
 */
export function normalizeComments(value: unknown): Record<CommentId, CommentThread> {
  if (!isRecord(value)) return {}

  const result: Record<CommentId, CommentThread> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    const anchor = normalizeAnchor(raw.anchor)
    if (!anchor) continue

    const id = (typeof raw.id === 'string' ? raw.id : key) as CommentId
    const thread: CommentThread = {
      id,
      anchor,
      author: normalizeAuthor(raw.author),
      body: typeof raw.body === 'string' ? raw.body : '',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
      replies: normalizeReplies(raw.replies),
    }

    if (typeof raw.editedAt === 'string') thread.editedAt = raw.editedAt
    if (raw.resolved === true) thread.resolved = true
    if (typeof raw.resolvedAt === 'string') thread.resolvedAt = raw.resolvedAt
    if (isRecord(raw.resolvedBy)) thread.resolvedBy = normalizeAuthor(raw.resolvedBy)
    const camera = normalizeCameraPose(raw.camera)
    if (camera) thread.camera = camera
    if (typeof raw.levelId === 'string' && raw.levelId) thread.levelId = raw.levelId as AnyNodeId

    result[id] = thread
  }
  return result
}
