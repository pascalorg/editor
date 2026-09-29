import {
  type AnyNode,
  type AnyNodeId,
  isApplyingRemoteSceneChange,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'

type NodeMap = Record<string, AnyNode>

/**
 * What a live session wrote to the scene: for each node it touched, the value
 * before its first write and the value it last wrote (`undefined` for
 * "absent"). Only writes made inside `record` count, so a collaborator's change
 * applied between two pointer moves is never mistaken for the session's.
 */
export type SessionWrites = {
  /** Runs one step of the session and records what it wrote. */
  record: <T>(run: () => T) => T
  /**
   * Also records every local write to `ids` until the session ends, whoever
   * makes it (the 3D tool mounted beside a plan session in split view drafts
   * the same node) — never a collaborator's change applied from the host.
   */
  watch: (ids: readonly string[]) => void
  /** Stops watching (the revert stops too). */
  stop: () => void
  /**
   * Takes back what the session wrote, outside history. A node changed again
   * since by someone else keeps that change: only the session's own fields go
   * back. A session that never wrote the scene touches nothing.
   */
  revert: () => void
  /** The session's writes as one change batch from the originals (the commit a legacy session makes). */
  changes: () => {
    create: { node: AnyNode; parentId?: AnyNodeId }[]
    update: { id: AnyNodeId; data: Partial<AnyNode> }[]
    delete: AnyNodeId[]
  }
  readonly size: number
}

/** The value a field had before the session first wrote it, and the value it last wrote. */
type FieldWrite = { had: boolean; from: unknown; to: unknown }

type Entry = {
  original: AnyNode | undefined
  wrote: AnyNode | undefined
  /** Fields the session changed on a node that existed before and after its write. */
  fields: Map<string, FieldWrite>
}

export function createSessionWrites(): SessionWrites {
  const writes = new Map<string, Entry>()
  let unwatch: (() => void) | null = null

  const note = (before: NodeMap, after: NodeMap, only?: ReadonlySet<string>) => {
    if (before === after) return
    const ids = only ?? new Set([...Object.keys(before), ...Object.keys(after)])
    for (const id of ids) {
      const prev = before[id]
      const next = after[id]
      if (prev === next) continue
      let entry = writes.get(id)
      if (!entry) {
        entry = { original: prev, wrote: next, fields: new Map() }
        writes.set(id, entry)
      } else entry.wrote = next
      if (!(prev && next)) continue
      const from = prev as Record<string, unknown>
      const to = next as Record<string, unknown>
      for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
        if (Object.is(from[key], to[key])) continue
        const field = entry.fields.get(key)
        if (field) field.to = to[key]
        else entry.fields.set(key, { had: Object.hasOwn(from, key), from: from[key], to: to[key] })
      }
    }
  }

  const created = (id: string) => {
    const entry = writes.get(id)
    return !!entry && !entry.original && !!entry.wrote
  }
  const deleted = (id: string) => {
    const entry = writes.get(id)
    return !!entry && !!entry.original && !entry.wrote
  }

  // Field by field: a field the session wrote goes back unless someone else
  // has written it since; every other field keeps its current value. A child
  // list drops the session's creations and gets back what it deleted.
  const revertFields = (current: AnyNode, entry: Entry): AnyNode | null => {
    const merged: Record<string, unknown> = { ...current }
    const cur = current as Record<string, unknown>
    let changed = false
    for (const [key, { had, from, to }] of entry.fields) {
      if (key === 'children' && Array.isArray(cur[key]) && Array.isArray(from)) {
        const children = (cur[key] as string[]).filter((id) => !created(id))
        for (const id of from as string[])
          if (deleted(id) && !children.includes(id)) children.push(id)
        if (children.join('|') !== (cur[key] as string[]).join('|')) {
          merged[key] = children
          changed = true
        }
        continue
      }
      if (!Object.is(cur[key], to)) continue
      if (had) merged[key] = from
      else delete merged[key]
      changed = true
    }
    if (!changed) return null
    // Nothing else moved: the node the session found, as it was (same object).
    const original = entry.original as Record<string, unknown> | undefined
    if (
      original &&
      Object.keys(merged).length === Object.keys(original).length &&
      Object.keys(merged).every((key) => Object.is(merged[key], original[key]))
    )
      return entry.original!
    return merged as AnyNode
  }

  const stop = () => {
    unwatch?.()
    unwatch = null
  }

  return {
    watch(ids) {
      stop()
      const scope = new Set(ids)
      unwatch = useScene.subscribe((state, previous) => {
        if (isApplyingRemoteSceneChange()) return
        note(previous.nodes as NodeMap, state.nodes as NodeMap, scope)
      })
    },
    stop,
    record(run) {
      const before = useScene.getState().nodes as NodeMap
      try {
        return run()
      } finally {
        note(before, useScene.getState().nodes as NodeMap)
      }
    },
    revert() {
      stop()
      if (writes.size === 0) return
      const nodes = useScene.getState().nodes as NodeMap
      const next: NodeMap = { ...nodes }
      const touched: AnyNode[] = []
      for (const [id, entry] of writes) {
        const current = nodes[id]
        if (!entry.original) {
          if (!current) continue
          delete next[id]
        } else if (!current) {
          next[id] = entry.original
        } else {
          const reverted = revertFields(current, entry)
          if (!reverted) continue
          next[id] = reverted
        }
        touched.push(entry.original ?? current!)
      }
      writes.clear()
      if (touched.length === 0) return
      pauseSceneHistory(useScene)
      try {
        useScene.setState({ nodes: next as ReturnType<typeof useScene.getState>['nodes'] })
      } finally {
        resumeSceneHistory(useScene)
      }
      const { markDirty } = useScene.getState()
      for (const node of touched) {
        if (next[node.id]) markDirty(node.id as AnyNodeId)
        if (node.parentId && next[node.parentId]) markDirty(node.parentId as AnyNodeId)
      }
    },
    changes() {
      const batch: ReturnType<SessionWrites['changes']> = { create: [], update: [], delete: [] }
      for (const [id, { original, wrote, fields }] of writes) {
        if (!original && wrote) {
          batch.create.push({ node: wrote, parentId: (wrote.parentId ?? undefined) as AnyNodeId })
        } else if (original && !wrote) {
          batch.delete.push(id as AnyNodeId)
        } else if (original && wrote) {
          const data: Record<string, unknown> = {}
          // Child lists follow the creates and deletes.
          for (const [key, { from, to }] of fields)
            if (key !== 'children' && JSON.stringify(from) !== JSON.stringify(to)) data[key] = to
          if (Object.keys(data).length)
            batch.update.push({ id: id as AnyNodeId, data: data as Partial<AnyNode> })
        }
      }
      return batch
    },
    get size() {
      return writes.size
    },
  }
}
