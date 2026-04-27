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

export async function openSqliteDatabase(filename: string): Promise<SqliteDatabase> {
  if ('Bun' in globalThis) {
    const mod = (await import('bun:sqlite')) as BunSqliteModule
    return new mod.Database(filename, { create: true, readwrite: true })
  }

  try {
    const mod = (await import('node:sqlite')) as NodeSqliteModule
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
