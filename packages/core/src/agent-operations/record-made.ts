import {
  createdBetween,
  type SessionKeep,
  type SessionRecord,
  startOfSession,
} from './scene-checkpoint'
import type { SceneNodes } from './types'

/** What a surface lends the recorder: its scene and the session record it keeps. */
export type MadeRecorderHost = {
  getNodes: () => SceneNodes
  readSession: () => SessionRecord
  keep: (keep: SessionKeep) => void
}

/**
 * Runs a call and keeps what it made in the agent's session: every node in the scene after it that
 * was not before, whichever way the call wrote it (a tool of its own, a patch, a shell). Writers that
 * report their own creations (`applyAgentOutcome`) say the same, and a node is made once.
 *
 * The session's first call also takes `start`, before anything is written. A call that replaces the
 * scene (a load, a clear) begins another session, and what it lays down is not the agent's.
 */
export async function recordMade<Result>(
  host: MadeRecorderHost,
  run: () => Promise<Result>,
): Promise<Result> {
  // A copy: a host may write its own map in place, and a "before" that grows reads nothing as new.
  const before = { ...host.getNodes() }
  const first = startOfSession(host.readSession(), before)
  if (first) host.keep(first)
  const began = host.readSession().checkpoints.start
  try {
    return await run()
  } finally {
    // The session of a scene too large to remember has no start, and nothing to look back from.
    if (began && host.readSession().checkpoints.start === began) {
      const made = createdBetween(before, host.getNodes())
      if (made.length) host.keep({ made })
    }
  }
}
