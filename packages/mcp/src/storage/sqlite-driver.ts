type SqliteBinding = string | number | bigint | boolean | null | Uint8Array

export interface SqliteRunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface SqliteStatement {
  all(...params: SqliteBinding[]): unknown[]
  get(...params: SqliteBinding[]): unknown
  run(...params: SqliteBinding[]): SqliteRunResult
}

export interface SqliteDatabase {
  exec(sql: string): void
  query(sql: string): SqliteStatement
  close(): void
}

type BunSqliteModule = {
  Database: new (
    filename: string,
    options?: { create?: boolean; readwrite?: boolean },
  ) => SqliteDatabase
}

type NodeStatementSync = {
  all(...params: SqliteBinding[]): unknown[]
  get(...params: SqliteBinding[]): unknown
  run(...params: SqliteBinding[]): SqliteRunResult
}

type NodeDatabaseSync = {
  exec(sql: string): void
  prepare(sql: string): NodeStatementSync
  close(): void
}

type NodeSqliteModule = {
  DatabaseSync: new (filename: string) => NodeDatabaseSync
}

function isNodeSqliteExperimentalWarning(warning: unknown, args: unknown[]) {
  const message =
    typeof warning === 'string'
      ? warning
      : warning instanceof Error
        ? warning.message
        : String(warning)
  const warningType =
    warning instanceof Error && typeof warning.name === 'string'
      ? warning.name
      : typeof args[0] === 'string'
        ? args[0]
        : undefined

  return warningType === 'ExperimentalWarning' && message.includes('SQLite')
}

async function importNodeSqlite(): Promise<NodeSqliteModule> {
  const originalEmitWarning = process.emitWarning.bind(process)
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isNodeSqliteExperimentalWarning(warning, args)) return
    return originalEmitWarning(warning as never, ...(args as never[]))
  }) as typeof process.emitWarning

  try {
    return (await import('node:sqlite')) as NodeSqliteModule
  } finally {
    process.emitWarning = originalEmitWarning
  }
}

export async function openSqliteDatabase(filename: string): Promise<SqliteDatabase> {
  if ('Bun' in globalThis) {
    const mod = (await import('bun:sqlite')) as BunSqliteModule
    return new mod.Database(filename, { create: true, readwrite: true })
  }

  try {
    const mod = await importNodeSqlite()
    return adaptNodeDatabase(new mod.DatabaseSync(filename))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `SQLite requires Bun or a Node runtime with node:sqlite support. Failed to open ${filename}: ${reason}`,
    )
  }
}

function adaptNodeDatabase(db: NodeDatabaseSync): SqliteDatabase {
  return {
    exec(sql: string): void {
      db.exec(sql)
    },
    query(sql: string): SqliteStatement {
      const stmt = db.prepare(sql)
      return {
        all: (...params) => stmt.all(...params),
        get: (...params) => stmt.get(...params),
        run: (...params) => stmt.run(...params),
      }
    },
    close(): void {
      db.close()
    },
  }
}
