'use client'

import { type ApiError, isApiError } from './api-contract'

export interface CallFailure {
  ok: false
  code: ApiError['error']['code']
  /** i18n key — resolve with resolveApiMessage before showing it. */
  messageKey: string
  details: Record<string, unknown>
}

export type CallResult<T> = { ok: true; data: T } | CallFailure

/**
 * Single fetch wrapper for every client call. Normalises three different failure
 * shapes — an error envelope, a non-JSON response, and a dead network — into one
 * result type, so screens never have to guess which one they got.
 */
export async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<CallResult<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      signal: init?.signal,
    })
  } catch {
    return { ok: false, code: 'server_error', messageKey: 'err.network', details: {} }
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok || isApiError(payload)) {
    if (isApiError(payload)) {
      return {
        ok: false,
        code: payload.error.code,
        messageKey: payload.error.message,
        details: payload.error.details ?? {},
      }
    }
    return { ok: false, code: 'server_error', messageKey: 'err.server', details: {} }
  }

  return { ok: true, data: payload as T }
}
