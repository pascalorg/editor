import { refuse } from '../agent-tools/refusal'
import {
  EMPTY_SESSION,
  MAX_CHECKPOINT_NODES,
  MAX_CHECKPOINTS,
  takeCheckpoint,
} from './scene-checkpoint'
import type { AgentOperation } from './types'

/**
 * `set_checkpoint`: the scene now, remembered under a name. The operation takes the checkpoint and
 * hands it back for the host to keep with the session; nothing in the scene changes.
 */
export const setCheckpoint: AgentOperation<{ name: string }> = (nodes, input, context) => {
  const name = input.name.trim()
  if (!name) refuse('name_required', 'Give the checkpoint a name, e.g. "walls done".')
  const session = context.session ?? EMPTY_SESSION
  const names = Object.keys(session.checkpoints)
  const replaced = names.includes(name)
  if (!replaced && names.length >= MAX_CHECKPOINTS)
    refuse(
      'too_many_checkpoints',
      `A session keeps at most ${MAX_CHECKPOINTS} checkpoints and has ${names.join(', ')}. Use one of those names to replace it.`,
      { checkpoints: names },
    )
  const size = Object.keys(nodes).length
  if (size > MAX_CHECKPOINT_NODES)
    refuse(
      'scene_too_large',
      `The scene has ${size} nodes; a checkpoint is kept for at most ${MAX_CHECKPOINT_NODES}.`,
      { nodes: size },
    )
  const checkpoint = takeCheckpoint(nodes, name, session.made.length)
  return {
    result: {
      ok: true,
      name,
      replaced,
      nodes: size,
      openCoherenceIssues: checkpoint.issues.length,
      checkpoints: replaced ? names : [...names, name],
      message: `Checkpoint "${name}" kept with this session. verify_scene({ since: "${name}" }) lists what changes after it.`,
    },
    keep: { checkpoint },
  }
}
