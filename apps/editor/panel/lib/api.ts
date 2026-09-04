import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'
import type { ApiError, ApiErrorCode } from './api-contract'

const STATUS: Record<ApiErrorCode, number> = {
  invalid_credentials: 401,
  account_locked: 423,
  account_inactive: 403,
  account_suspended: 403,
  sso_required: 403,
  mfa_required: 401,
  mfa_invalid: 401,
  mfa_not_enrolled: 409,
  recovery_invalid: 401,
  token_invalid: 400,
  token_expired: 410,
  invite_expired: 410,
  invite_revoked: 410,
  password_policy: 422,
  password_mismatch: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 422,
  rate_limited: 429,
  server_error: 500,
}

export function ok<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init)
}

export function fail(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: STATUS[code] },
  )
}

/**
 * Parses a JSON body against a schema. Returns a discriminated result so the
 * handler stays flat — no try/catch around every route.
 */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse<ApiError> }> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: fail('validation', 'err.badJson') }
  }

  try {
    return { ok: true, data: schema.parse(raw) }
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0]
      // A schema-level refine can carry a specific code (password_mismatch);
      // anything else is a plain validation failure.
      const params = (first as { params?: { code?: ApiErrorCode } } | undefined)?.params
      const code = params?.code ?? 'validation'
      return {
        ok: false,
        response: fail(
          code,
          first?.message?.startsWith('err.') ? first.message : 'err.validation',
          {
            field: first?.path.join('.') ?? null,
          },
        ),
      }
    }
    return { ok: false, response: fail('validation', 'err.validation') }
  }
}

/** Wraps a handler so an unexpected throw becomes a 500 envelope, not an HTML page. */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (err) {
      console.error('[api]', err)
      return fail('server_error', 'err.server')
    }
  }
}
