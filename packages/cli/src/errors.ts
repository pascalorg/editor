export class CliError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly exitCode: number

  constructor(code: string, message: string, details?: unknown, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.details = details
    this.exitCode = exitCode
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  const nodeCode = (error as { code?: unknown })?.code
  if (typeof nodeCode === 'string' && nodeCode.startsWith('ERR_PARSE_ARGS_')) {
    return new CliError(
      'invalid_option',
      error instanceof Error ? error.message : 'Invalid command options.',
      undefined,
      2,
    )
  }
  return new CliError(
    'unexpected_error',
    error instanceof Error ? error.message : 'An unexpected error occurred.',
  )
}
