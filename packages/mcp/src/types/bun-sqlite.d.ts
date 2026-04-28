declare module 'bun:sqlite' {
  export type SQLQueryBindings =
    | string
    | number
    | bigint
    | boolean
    | null
    | Uint8Array
    | Record<string, unknown>

  export interface SQLQueryResult {
    changes: number
    lastInsertRowid: number | bigint
  }

  export interface Statement {
    all(...params: SQLQueryBindings[]): unknown[]
    get(...params: SQLQueryBindings[]): unknown
    run(...params: SQLQueryBindings[]): SQLQueryResult
  }

  export interface DatabaseOptions {
    create?: boolean
    readwrite?: boolean
    readonly?: boolean
  }

  export class Database {
    constructor(filename: string, options?: DatabaseOptions)
    exec(sql: string): void
    query(sql: string): Statement
    close(): void
  }
}
