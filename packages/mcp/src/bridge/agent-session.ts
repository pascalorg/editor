import {
  EMPTY_SESSION,
  keepInSession,
  type SessionKeep,
  type SessionRecord,
} from '@pascal-app/core/agent-operations'

/**
 * Where a host keeps what the agent's session should remember: the moments it named and what it
 * made. Never scene data. A host with sessions that outlive the process keeps it beside them.
 */
export type AgentSession = {
  read(): SessionRecord
  keep(keep: SessionKeep): void
  /** Starts another session, or puts one back: a host reloading the scene it is bound to keeps it. */
  replace(record?: SessionRecord): void
}

/** The standalone server's: in memory, for as long as the bridge holds a scene. */
export class InMemoryAgentSession implements AgentSession {
  #record: SessionRecord = EMPTY_SESSION

  read(): SessionRecord {
    return this.#record
  }

  keep(keep: SessionKeep): void {
    this.#record = keepInSession(this.#record, keep)
  }

  replace(record: SessionRecord = EMPTY_SESSION): void {
    this.#record = record
  }
}
