import { refuse } from '../agent-tools/refusal'
import type { AnyNode } from '../schema'
import type { SceneChanges, SceneNodes } from './types'

const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => equal(value, b[index]))
  if (record(a) && record(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((key) => equal(a[key], b[key]))
  }
  return false
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function merged(base: unknown, current: unknown, next: unknown, path: string): unknown {
  if (equal(base, next) || equal(current, next)) return current
  if (equal(base, current)) return next
  if (record(base) && record(current) && record(next)) {
    const result: Record<string, unknown> = {}
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(current),
      ...Object.keys(next),
    ])) {
      const value = merged(base[key], current[key], next[key], `${path}.${key}`)
      if (value !== undefined) result[key] = value
    }
    return result
  }
  if (
    path.endsWith('.children') &&
    Array.isArray(base) &&
    Array.isArray(current) &&
    Array.isArray(next)
  ) {
    return [
      ...new Set([
        ...current.filter((id) => !base.includes(id) || next.includes(id)),
        ...next.filter((id) => !base.includes(id)),
      ]),
    ]
  }
  refuse(
    'authored_edit_conflict',
    `Both the design and the current scene changed ${path}. Preserve the current edit and resolve this change explicitly.`,
    { path, mutationApplied: false },
  )
}

/** Apply a design delta against its last candidate, preserving edits made since that candidate. */
export function authoredSceneChanges(
  current: SceneNodes,
  base: SceneNodes,
  next: SceneNodes,
): SceneChanges {
  const create: NonNullable<SceneChanges['create']> = []
  const update: NonNullable<SceneChanges['update']> = []
  const remove: string[] = []
  const effective: Record<string, AnyNode> = { ...current }
  for (const id of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const old = base[id]
    const now = current[id]
    const desired = next[id]
    if (!old) {
      if (!desired) continue
      if (now) {
        if (!equal(now, desired))
          refuse('authored_id_conflict', `Node ${id} already belongs to existing work.`, {
            mutationApplied: false,
          })
        continue
      }
      create.push({ node: desired, parentId: desired.parentId ?? undefined })
      effective[id] = desired
    } else if (!now) {
      // A person's deletion wins over regeneration, including a same-payload replay.
      delete effective[id]
    } else if (!desired) {
      if (!equal(now, old))
        refuse(
          'authored_edit_conflict',
          `Node ${id} was edited after conversion and cannot be removed by regeneration.`,
          { mutationApplied: false },
        )
      remove.push(id)
      delete effective[id]
    } else {
      const value = merged(old, now, desired, id) as AnyNode
      effective[id] = value
      if (!equal(now, value)) {
        const data: Record<string, unknown> = {}
        for (const key of new Set([...Object.keys(now), ...Object.keys(value)])) {
          if (
            !equal((now as Record<string, unknown>)[key], (value as Record<string, unknown>)[key])
          )
            data[key] = (value as Record<string, unknown>)[key]
        }
        update.push({ id, data: data as Partial<AnyNode> })
      }
    }
  }
  for (const node of Object.values(effective)) {
    if (node.parentId && !effective[node.parentId])
      refuse(
        'authored_edit_conflict',
        `Removing ${node.parentId} would discard or orphan ${node.id}. Preserve the current hierarchy.`,
        { mutationApplied: false },
      )
  }
  return { create, update, delete: remove }
}
