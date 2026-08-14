'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CommentAuthor,
  type CommentId,
  type CommentThread,
  emitter,
  resolveCommentAnchorPosition,
  useScene,
} from '@pascal-app/core'
import { cameraPoseStore } from '../store/camera-pose-store'
import type { CommentDraft } from '../store/use-comment-ui'

const AUTHOR_STORAGE_KEY = 'pascal-comment-author'
const FALLBACK_AUTHOR_NAME = 'You'

/**
 * Who the next comment is attributed to.
 *
 * There are no accounts yet — that is the Cloud & Scale milestone — so this is
 * a display name the visitor sets once and keeps in `localStorage`. Reading it
 * per call rather than caching keeps a rename in one tab from being stale in
 * the pin the next click drops.
 */
export function currentCommentAuthor(): CommentAuthor {
  if (typeof window === 'undefined') return { name: FALLBACK_AUTHOR_NAME }
  try {
    const stored = window.localStorage.getItem(AUTHOR_STORAGE_KEY)?.trim()
    return { name: stored || FALLBACK_AUTHOR_NAME }
  } catch {
    return { name: FALLBACK_AUTHOR_NAME }
  }
}

export function setCommentAuthorName(name: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AUTHOR_STORAGE_KEY, name.trim())
  } catch {
    // A blocked storage quota is not worth failing a comment over.
  }
}

/**
 * Origin of a node in world space, for anchors that follow their element.
 *
 * Only kinds that expose a plain numeric `position` can be followed. A wall is
 * `start`/`end`, a slab is a polygon — resolving those would mean
 * re-implementing each kind's geometry here, and getting it wrong moves
 * someone's pin to the wrong room. Returning `null` is the honest answer:
 * `resolveCommentAnchorPosition` then falls back to where the pin was dropped.
 */
function nodeOrigin(
  nodes: Record<AnyNodeId, AnyNode>,
  id: AnyNodeId,
): [number, number, number] | null {
  const node = nodes[id]
  if (!node) return null
  const position = (node as { position?: unknown }).position
  if (!Array.isArray(position) || position.length !== 3) return null
  if (!position.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  return position as [number, number, number]
}

/**
 * Where a thread's pin belongs right now. Shared by the 3D overlay and the 2D
 * floorplan layer so the two views never disagree about a pin's location.
 */
export function resolveCommentPinPosition(
  thread: CommentThread,
  nodes: Record<AnyNodeId, AnyNode>,
): [number, number, number] {
  return resolveCommentAnchorPosition(thread.anchor, (id) => nodeOrigin(nodes, id))
}

/**
 * Turn a dropped pin into a thread. The camera is captured for 3D-dropped pins
 * only: a 2D pin has no pose to return to, and recording the last 3D pose there
 * would send a reader somewhere the author never looked.
 */
export function createCommentFromDraft(draft: CommentDraft, body: string): CommentId | null {
  const text = body.trim()
  if (!text) return null

  const camera = draft.origin === '3d' ? cameraPoseStore.getState().pose : null

  return useScene.getState().createComment({
    anchor: {
      position: draft.position,
      ...(draft.nodeId && { nodeId: draft.nodeId as AnyNodeId }),
      ...(draft.nodeId && draft.offset && { offset: draft.offset }),
    },
    author: currentCommentAuthor(),
    body: text,
    ...(camera && { camera: { ...camera } }),
    ...(draft.levelId && { levelId: draft.levelId as AnyNodeId }),
  })
}

/**
 * Restore the framing a thread was written against. No-op for a thread with no
 * recorded camera (one dropped from the 2D view).
 */
export function applyCommentCamera(thread: CommentThread): boolean {
  if (!thread.camera) return false
  emitter.emit('camera-controls:apply-pose', thread.camera)
  return true
}

/** Total messages in a thread — the opening comment plus its replies. */
export function commentMessageCount(thread: CommentThread): number {
  return 1 + thread.replies.length
}
