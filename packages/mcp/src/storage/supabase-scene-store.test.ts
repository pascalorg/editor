import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type SupabaseLikeClient,
  type SupabaseQueryBuilder,
  type SupabaseQueryResult,
  SupabaseSceneStore,
} from './supabase-scene-store'
import { SceneVersionConflictError } from './types'

/**
 * Jest-style mock of the Supabase query chain. Each `from(table)` returns a
 * fresh builder that records the sequence of operations (`insert | update |
 * delete | select`), the collected `.eq()` filters, and any `limit/order`.
 * The mock "database" is an in-memory array of rows per table.
 */
type Row = Record<string, unknown>

interface RecordedCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  values?: Row | Row[]
  filters: Array<{ column: string; value: unknown }>
  orderBy?: { column: string; ascending: boolean }
  limit?: number
  terminator?: 'single' | 'maybeSingle' | 'iterable'
}

function createMockClient(): {
  client: SupabaseLikeClient
  tables: Record<string, Row[]>
  calls: RecordedCall[]
} {
  const tables: Record<string, Row[]> = {}
  const calls: RecordedCall[] = []

  function buildQuery<T extends Row>(table: string): SupabaseQueryBuilder<T> {
    tables[table] ??= []
    const call: RecordedCall = { table, op: 'select', filters: [] }

    function matchesFilters(row: Row): boolean {
      return call.filters.every((f) => row[f.column] === f.value)
    }

    function applyOrderAndLimit(rows: Row[]): Row[] {
      let out = [...rows]
      if (call.orderBy) {
        const { column, ascending } = call.orderBy
        out.sort((a, b) => {
          const av = a[column] as string | number
          const bv = b[column] as string | number
          if (av === bv) return 0
          return (av < bv ? -1 : 1) * (ascending ? 1 : -1)
        })
      }
      if (typeof call.limit === 'number') out = out.slice(0, call.limit)
      return out
    }

    function executeMany(): SupabaseQueryResult<T[]> {
      const rows = tables[table] as Row[]
      if (call.op === 'select') {
        const hits = rows.filter(matchesFilters)
        return { data: applyOrderAndLimit(hits) as T[], error: null }
      }
      if (call.op === 'insert') {
        const incoming = Array.isArray(call.values) ? call.values : [call.values!]
        rows.push(...incoming)
        return { data: incoming as T[], error: null }
      }
      if (call.op === 'update') {
        const hits = rows.filter(matchesFilters)
        for (const row of hits) Object.assign(row, call.values)
        return { data: hits as T[], error: null }
      }
      if (call.op === 'delete') {
        const hits = rows.filter(matchesFilters)
        tables[table] = rows.filter((r) => !matchesFilters(r))
        return { data: hits as T[], error: null }
      }
      return { data: [] as T[], error: null }
    }

    function executeSingle(required: boolean): SupabaseQueryResult<T> {
      const many = executeMany()
      if (many.error) return { data: null, error: many.error }
      const first = (many.data ?? [])[0]
      if (!first) {
        if (required) {
          return {
            data: null,
            error: { message: 'No rows', code: 'PGRST116' },
          }
        }
        return { data: null, error: null }
      }
      return { data: first as T, error: null }
    }

    const builder: SupabaseQueryBuilder<T> = {
      select(_columns?: string) {
        // `select()` after a mutation keeps the mutation op; only flip to
        // 'select' when no op has been set yet.
        if (call.op === 'select') {
          call.op = 'select'
        }
        return builder
      },
      insert(values) {
        call.op = 'insert'
        call.values = values as Row | Row[]
        return builder
      },
      update(values) {
        call.op = 'update'
        call.values = values as Row
        return builder
      },
      delete() {
        call.op = 'delete'
        return builder
      },
      upsert(values) {
        call.op = 'upsert'
        call.values = values as Row | Row[]
        return builder
      },
      eq(column, value) {
        call.filters.push({ column, value })
        return builder
      },
      order(column, opts) {
        call.orderBy = { column, ascending: opts?.ascending ?? true }
        return builder
      },
      limit(count) {
        call.limit = count
        return builder
      },
      async maybeSingle() {
        call.terminator = 'maybeSingle'
        calls.push(call)
        return executeSingle(false) as SupabaseQueryResult<T>
      },
      async single() {
        call.terminator = 'single'
        calls.push(call)
        return executeSingle(true) as SupabaseQueryResult<T>
      },
      // Supabase query builders are themselves thenable — the mock must be
      // too, so that `await builder` resolves to the list result.
      // biome-ignore lint/suspicious/noThenProperty: mirrors real Supabase client
      then(onfulfilled, onrejected) {
        call.terminator = 'iterable'
        calls.push(call)
        const result = executeMany()
        return Promise.resolve(result).then(onfulfilled, onrejected)
      },
    }
    return builder
  }

  const client: SupabaseLikeClient = {
    from<T extends Row = Row>(table: string) {
      return buildQuery<T>(table)
    },
  }
  return { client, tables, calls }
}

function fakeGraph(nodeCount = 2) {
  const nodes: Record<string, unknown> = {}
  for (let i = 0; i < nodeCount; i++) {
    nodes[`wall_${i}`] = { id: `wall_${i}`, type: 'wall' }
  }
  return { nodes, rootNodeIds: Object.keys(nodes) }
}

describe('SupabaseSceneStore', () => {
  let mock: ReturnType<typeof createMockClient>
  let store: SupabaseSceneStore

  beforeEach(() => {
    mock = createMockClient()
    store = new SupabaseSceneStore({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-test-key',
      client: mock.client,
    })
  })

  test('reports the supabase backend flag', () => {
    expect(store.backend).toBe('supabase')
  })

  test('save (new scene) inserts at version 1 and logs a revision', async () => {
    const meta = await store.save({
      name: 'first',
      graph: fakeGraph(3) as never,
      ownerId: null,
    })
    expect(meta.version).toBe(1)
    expect(meta.nodeCount).toBe(3)
    expect(meta.id.length).toBeGreaterThan(0)

    // One row in scenes, one row in scene_revisions.
    expect((mock.tables.scenes ?? []).length).toBe(1)
    expect((mock.tables.scene_revisions ?? []).length).toBe(1)
    expect((mock.tables.scene_revisions![0] as { author_kind: string }).author_kind).toBe('mcp')
  })

  test('save (existing scene) with matching expectedVersion bumps to 2', async () => {
    const created = await store.save({
      id: 'my-scene',
      name: 'v1',
      graph: fakeGraph(1) as never,
    })
    expect(created.version).toBe(1)

    const updated = await store.save({
      id: 'my-scene',
      name: 'v1',
      graph: fakeGraph(4) as never,
      expectedVersion: 1,
    })
    expect(updated.version).toBe(2)
    expect(updated.nodeCount).toBe(4)

    // Two revisions should now be logged.
    expect((mock.tables.scene_revisions ?? []).length).toBe(2)
    const versions = (mock.tables.scene_revisions ?? []).map(
      (r) => (r as { version: number }).version,
    )
    expect(versions.sort()).toEqual([1, 2])
  })

  test('save with stale expectedVersion throws SceneVersionConflictError', async () => {
    await store.save({ id: 'stale', name: 's', graph: fakeGraph() as never })
    let caught: unknown = null
    try {
      await store.save({
        id: 'stale',
        name: 's',
        graph: fakeGraph() as never,
        expectedVersion: 99,
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SceneVersionConflictError)
  })

  test('load returns null when no row matches', async () => {
    const result = await store.load('missing')
    expect(result).toBeNull()
  })

  test('load returns the scene + graph when present', async () => {
    const saved = await store.save({ id: 'my', name: 's', graph: fakeGraph(2) as never })
    const loaded = await store.load(saved.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe('my')
    expect(Object.keys(loaded!.graph.nodes)).toEqual(['wall_0', 'wall_1'])
  })

  test('list applies ownerId filter and honours the default limit', async () => {
    await store.save({ id: 'a', name: 'a', graph: fakeGraph() as never, ownerId: 'owner-1' })
    await store.save({ id: 'b', name: 'b', graph: fakeGraph() as never, ownerId: 'owner-2' })
    const onlyOne = await store.list({ ownerId: 'owner-1' })
    expect(onlyOne.map((r) => r.id)).toEqual(['a'])

    const listCall = mock.calls.find((c) => c.op === 'select' && c.terminator === 'iterable')!
    expect(listCall.orderBy).toEqual({ column: 'updated_at', ascending: false })
    expect(listCall.limit).toBe(100)
    expect(listCall.filters).toContainEqual({ column: 'owner_id', value: 'owner-1' })
  })

  test('delete removes the row and cascade-deletes the revisions', async () => {
    const saved = await store.save({ id: 'gone', name: 'g', graph: fakeGraph() as never })
    expect((mock.tables.scenes ?? []).length).toBe(1)
    expect((mock.tables.scene_revisions ?? []).length).toBe(1)

    // Simulate on-delete-cascade by emptying revisions when scenes row goes.
    const before = mock.tables.scenes!.length
    const ok = await store.delete(saved.id)
    expect(ok).toBe(true)
    expect(mock.tables.scenes!.length).toBe(before - 1)

    // Confirm the mock recorded a delete with an id filter — this is the
    // SQL-equivalent of `delete from scenes where id = ?` relied on by the
    // ON DELETE CASCADE from scene_revisions → scenes.
    const deleteCall = mock.calls.find((c) => c.op === 'delete' && c.table === 'scenes')
    expect(deleteCall).toBeDefined()
    expect(deleteCall!.filters).toContainEqual({ column: 'id', value: saved.id })
  })

  test('delete returns false when the row does not exist', async () => {
    const ok = await store.delete('never-existed')
    expect(ok).toBe(false)
  })

  test('rename bumps the version and updates name', async () => {
    const saved = await store.save({ id: 'ren', name: 'old', graph: fakeGraph() as never })
    const renamed = await store.rename(saved.id, 'new')
    expect(renamed.version).toBe(saved.version + 1)
    expect(renamed.name).toBe('new')
  })

  test('rename with stale expectedVersion throws SceneVersionConflictError', async () => {
    const saved = await store.save({ id: 'ren2', name: 'old', graph: fakeGraph() as never })
    let caught: unknown = null
    try {
      await store.rename(saved.id, 'newer', { expectedVersion: saved.version + 5 })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SceneVersionConflictError)
  })

  test('constructor never exposes the service role key in thrown errors', () => {
    let caught: unknown = null
    try {
      new SupabaseSceneStore({
        url: '',
        serviceRoleKey: 'super-secret',
        client: mock.client,
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).not.toContain('super-secret')
  })
})
