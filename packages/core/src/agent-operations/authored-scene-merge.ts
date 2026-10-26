import { refuse } from '../agent-tools/refusal'
import type { AnyNode } from '../schema'
import {
  isDerivedNode,
  manualSurfaceHoles,
  reconcilerOwnedFields,
} from '../store/derived-node-guard'
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

/** What a script's compile produced, against what was asked of it (`GeometryScriptSource`). */
const COMPILE_OUTPUTS = ['artifact', 'manifest', 'images', 'inputs']
const scriptSource = (value: unknown): value is Record<string, unknown> =>
  record(value) && value.kind === 'script' && typeof value.script === 'string'
const intent = (source: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => !COMPILE_OUTPUTS.includes(key)))

/**
 * Between conversions Pascal rebuilds what it derives: the reconciler a derived surface's outline,
 * holes and openings, a script's compile on its new outline, the order of children. None of it is
 * a person's edit, so none of it may refuse the design's next revision; a person's cut-out in a
 * derived surface, and any script code or params they changed, still are.
 */
const reconcilerOwned = (current: AnyNode, base: AnyNode) => {
  if (!isDerivedNode(current)) return new Set<string>()
  const owned = new Set(reconcilerOwnedFields(current))
  if (!equal(manualSurfaceHoles(base), manualSurfaceHoles(current)))
    for (const field of ['holes', 'holeMetadata']) owned.delete(field)
  return owned
}

/** A value as a person edits it: every script in it without its compile. */
const asEdited = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(asEdited)
  if (!record(value)) return value
  const kept = scriptSource(value) ? intent(value) : value
  return Object.fromEntries(Object.entries(kept).map(([key, entry]) => [key, asEdited(entry)]))
}

/** A node as a person edits it: without what Pascal derives on it, its children in any order. */
function personView(node: AnyNode, owned: ReadonlySet<string>) {
  const view = asEdited(
    Object.fromEntries(Object.entries(node).filter(([key]) => !owned.has(key))),
  ) as Record<string, unknown>
  if (Array.isArray(view.children)) view.children = [...view.children].sort()
  return view
}

function merged(base: unknown, current: unknown, next: unknown, path: string): unknown {
  if (equal(base, next) || equal(current, next)) return current
  // A side that changed nothing but compiles has changed nothing: a compile follows its code.
  if (equal(asEdited(base), asEdited(current))) return next
  if (equal(asEdited(base), asEdited(next))) return current
  if (scriptSource(base) && scriptSource(current) && scriptSource(next)) {
    if (equal(intent(current), intent(next))) return next
    refuse(
      'authored_edit_conflict',
      `Both the design and the current scene changed the script at ${path}. Preserve the current edit and resolve this change explicitly.`,
      { path, mutationApplied: false },
    )
  }
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
      const owned = reconcilerOwned(now, old)
      if (!equal(personView(now, owned), personView(old, owned)))
        refuse(
          'authored_edit_conflict',
          `Node ${id} was edited after conversion and cannot be removed by regeneration.`,
          { mutationApplied: false },
        )
      remove.push(id)
      delete effective[id]
    } else {
      const owned = reconcilerOwned(now, old)
      const value = Object.fromEntries(
        [...new Set([...Object.keys(old), ...Object.keys(now), ...Object.keys(desired)])].flatMap(
          (key) => {
            const [b, c, n] = [old, now, desired].map(
              (node) => (node as Record<string, unknown>)[key],
            )
            // What the reconciler owns follows the design where it changed, else stays as derived.
            const entry = owned.has(key) ? (equal(b, n) ? c : n) : merged(b, c, n, `${id}.${key}`)
            return entry === undefined ? [] : [[key, entry]]
          },
        ),
      ) as AnyNode
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
