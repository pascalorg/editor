import { Database } from 'bun:sqlite'

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

/**
 * Open a SQLite database using Bun's built-in `bun:sqlite` driver.
 *
 * Pascal targets the Bun runtime exclusively, so there is no Node fallback and
 * no external SQLite dependency — `bun:sqlite` ships with the runtime.
 */
export function openSqliteDatabase(filename: string): SqliteDatabase {
  return new Database(filename, { create: true, readwrite: true })
}
