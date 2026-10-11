import { z } from 'zod'
import { checkCoherence } from '../coherence'
import { activeIssues } from '../coherence/disputes'
import { type AnyNode, isDefaultGutterNode } from '../schema'
import { isDerivedNode } from '../store/derived-node-guard'
import { measureScene, type SceneMeasure } from './scene-measure'
import { levelIdOf } from './scene-queries'
import type { SceneChanges, SceneNodes } from './types'

/**
 * What an agent session keeps about its own work: the moments it named, and what it made. The core
 * computes and reads these and stores none: each host keeps its record where its sessions live, so
 * a checkpoint is never scene data (it would dirty the scene, enter undo and change its hash).
 */

/** One node as a checkpoint remembers it: enough to say what it was when it is gone. */
export type CheckpointNode = { type: string; levelId: string | null; hash: string; name?: string }

/** A node the agent created, kept when it is later deleted: the proof it was there. */
export type MadeEntry = { id: string; type: string; levelId: string | null; name?: string }

export type SessionCheckpoint = {
  name: string
  /** The registered families' places, for `changesSince` (windows, lit rooms…). */
  measure: SceneMeasure
  nodes: Record<string, CheckpointNode>
  /** Ids of the coherence issues open when it was taken. */
  issues: string[]
  /** How many entries of the session's `made` list there were: what follows was made after it. */
  madeAt: number
}

export type SessionRecord = {
  checkpoints: Record<string, SessionCheckpoint>
  made: MadeEntry[]
}

/** What an operation or a write asks its host to keep. */
export type SessionKeep = { checkpoint?: SessionCheckpoint; made?: readonly MadeEntry[] }

export const EMPTY_SESSION: SessionRecord = { checkpoints: {}, made: [] }

/** A session names at most this many moments, `start` included. */
export const MAX_CHECKPOINTS = 8
/** A checkpoint of a larger scene is refused: it is about 60 bytes a node, kept with the session. */
export const MAX_CHECKPOINT_NODES = 5000
/** The made list stops growing here; the session record stays bounded. */
export const MAX_MADE = 20_000

/**
 * The record after a keep: a checkpoint of the same name is replaced, made entries accumulate. A node
 * is made once, however many writers report it, and the list only ever grows at its end (a
 * checkpoint's `madeAt` indexes into it). What the scene had when the session began was never made
 * by the agent: an undo that puts it back does not make it.
 */
export function keepInSession(session: SessionRecord, keep: SessionKeep): SessionRecord {
  const known = new Set(session.made.map((entry) => entry.id))
  const began = session.checkpoints.start?.nodes
  const fresh = (keep.made ?? []).filter((entry) => {
    if (known.has(entry.id) || began?.[entry.id]) return false
    known.add(entry.id)
    return true
  })
  return {
    checkpoints: keep.checkpoint
      ? { ...session.checkpoints, [keep.checkpoint.name]: keep.checkpoint }
      : session.checkpoints,
    made: fresh.length ? [...session.made, ...fresh].slice(0, MAX_MADE) : session.made,
  }
}

const FNV_PRIME = 0x01000193

/** Plain JSON in a fixed key order, numbers to a tenth of a millimetre, undefined dropped. */
function stable(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 1e4) / 1e4)
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`
}

/**
 * A node's fingerprint, eight hex digits. Its children are left out (a wall that gained a door did
 * not change; the door is new) and so are the checker's notes in its metadata (a dispute is not an
 * edit of the building).
 */
export function hashNode(node: AnyNode): string {
  const {
    children: _children,
    metadata,
    ...rest
  } = node as AnyNode & {
    children?: unknown
    metadata?: Record<string, unknown>
  }
  const { coherence: _notes, ...kept } = metadata ?? {}
  let hash = 0x811c9dc5
  const text = stable({ ...rest, metadata: kept })
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const nameOf = (node: AnyNode) =>
  typeof node.name === 'string' && node.name ? { name: node.name } : {}

/** The scene as a checkpoint remembers it: every node's fingerprint, and the issues then open. */
export function takeCheckpoint(nodes: SceneNodes, name: string, madeAt: number): SessionCheckpoint {
  const remembered: Record<string, CheckpointNode> = {}
  for (const node of Object.values(nodes))
    remembered[node.id] = {
      type: node.type,
      levelId: levelIdOf(nodes, node.id),
      hash: hashNode(node),
      ...nameOf(node),
    }
  return {
    name,
    measure: measureScene(nodes),
    nodes: remembered,
    issues: activeIssues(checkCoherence(nodes), nodes)
      .map((issue) => issue.id)
      .sort(),
    madeAt,
  }
}

/**
 * Construction the editor derives from what the agent drew: floor plates, auto ceilings, default
 * gutters. Their ids change as the reconciler rebuilds them, so none is a thing the agent made.
 */
const isDerivedConstruction = (node: AnyNode) => isDerivedNode(node) || isDefaultGutterNode(node)

const madeEntry = (nodes: SceneNodes, node: AnyNode): MadeEntry => ({
  id: node.id,
  type: node.type,
  levelId: levelIdOf(nodes, node.id),
  ...nameOf(node),
})

/** The nodes a write created, as the session remembers them. */
export function madeEntries(after: SceneNodes, written: readonly SceneChanges[]): MadeEntry[] {
  return written
    .flatMap((changes) => (changes.create ?? []).map(({ node }) => after[node.id] ?? node))
    .filter((node) => !isDerivedConstruction(node))
    .map((node) => madeEntry(after, node))
}

/**
 * The nodes that are in `after` and were not in `before`: what a writer that diffs made, which is
 * every tool that writes, whatever it calls to do so.
 */
export function createdBetween(before: SceneNodes, after: SceneNodes): MadeEntry[] {
  return Object.values(after)
    .filter((node) => !(node.id in before) && !isDerivedConstruction(node))
    .map((node) => madeEntry(after, node))
}

/**
 * What a host keeps at a session's first call, before anything is written: the scene as it stood,
 * under the name `start`. The beginning of the agent's work is always a checkpoint. Nothing when
 * the session has one, or the scene is too large to remember.
 */
export function startOfSession(session: SessionRecord, nodes: SceneNodes): SessionKeep | undefined {
  if (session.checkpoints.start || Object.keys(nodes).length > MAX_CHECKPOINT_NODES)
    return undefined
  return { checkpoint: takeCheckpoint(nodes, 'start', session.made.length) }
}

const Place = z.object({ x: z.number(), z: z.number(), name: z.string().optional() })
const Measure = z.object({
  levels: z.record(
    z.string(),
    z.object({ name: z.string(), families: z.record(z.string(), z.array(Place)) }),
  ),
})
const Remembered = z.object({
  type: z.string(),
  levelId: z.string().nullable(),
  hash: z.string().regex(/^[0-9a-f]{8}$/),
  name: z.string().optional(),
})
const Checkpoint = z.object({
  name: z.string().min(1),
  measure: Measure,
  nodes: z
    .record(z.string(), Remembered)
    .refine((nodes) => Object.keys(nodes).length <= MAX_CHECKPOINT_NODES),
  issues: z.array(z.string()),
  madeAt: z.number().int().min(0),
})
const Made = z.object({
  id: z.string(),
  type: z.string(),
  levelId: z.string().nullable(),
  name: z.string().optional(),
})
const Record_ = z.object({
  checkpoints: z
    .record(z.string(), Checkpoint)
    .refine((checkpoints) => Object.keys(checkpoints).length <= MAX_CHECKPOINTS),
  made: z.array(Made).max(MAX_MADE),
})

/**
 * A session record read back from where a host stored it. Anything that is not one is no record:
 * the session starts empty rather than the host failing on what is only a convenience.
 */
export function parseSessionRecord(input: unknown): SessionRecord {
  const parsed = Record_.safeParse(input)
  return parsed.success ? (parsed.data as SessionRecord) : EMPTY_SESSION
}
