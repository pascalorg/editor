/**
 * A sane, expected failure of an agent operation: the request cannot be done as asked, and the
 * message says why and what would work ("Wall wall_a is 0.80 m long, too short for a 0.90 m
 * door."). Every surface answers it the same way, `{ error, code, ...details }`, and counts it by
 * `code` — a refusal is information for the model, not a crash.
 */
export class AgentRefusal extends Error {
  override readonly name = 'AgentRefusal'
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export function isAgentRefusal(error: unknown): error is AgentRefusal {
  return (
    error instanceof AgentRefusal ||
    (error instanceof Error &&
      error.name === 'AgentRefusal' &&
      typeof (error as { code?: unknown }).code === 'string')
  )
}

export function refuse(code: string, message: string, details?: Record<string, unknown>): never {
  throw new AgentRefusal(code, message, details)
}

/** The answer both surfaces return for a refusal. */
export function refusalPayload(error: AgentRefusal) {
  return { error: error.message, code: error.code, ...error.details }
}
