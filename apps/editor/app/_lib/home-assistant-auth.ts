import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

export const HOME_ASSISTANT_OAUTH_COOKIE = 'pascal_ha_oauth'

export type HomeAssistantOauthCookieState = {
  clientId: string
  externalUrl: string | null
  instanceUrl: string
  redirectUri: string
  state: string
}

export type HomeAssistantTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  token_type: string
}

function normalizeUrlValue(value: string) {
  return value.trim().replace(/\/$/, '')
}

export function normalizeHomeAssistantUrl(value: string) {
  const normalized = normalizeUrlValue(value)
  const url = new URL(normalized)
  if (!(url.protocol === 'http:' || url.protocol === 'https:')) {
    throw new Error('Home Assistant URL must use http or https.')
  }
  return url.toString().replace(/\/$/, '')
}

export function normalizeOptionalHomeAssistantUrl(value: string | null | undefined) {
  if (!value || value.trim().length === 0) {
    return null
  }
  return normalizeHomeAssistantUrl(value)
}

export function getRequestOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (forwardedHost && forwardedProto) {
    return `${forwardedProto}://${forwardedHost}`
  }
  return request.nextUrl.origin
}

export function buildHomeAssistantOauthState(
  request: NextRequest,
  instanceUrl: string,
  externalUrl: string | null,
): HomeAssistantOauthCookieState {
  const clientId = getRequestOrigin(request)
  return {
    clientId,
    externalUrl,
    instanceUrl,
    redirectUri: `${clientId}/api/home-assistant/oauth/callback`,
    state: randomUUID(),
  }
}

function getOauthBaseUrl(oauthState: Pick<HomeAssistantOauthCookieState, 'externalUrl' | 'instanceUrl'>) {
  return oauthState.externalUrl ?? oauthState.instanceUrl
}

export function buildHomeAssistantAuthorizeUrl(oauthState: HomeAssistantOauthCookieState) {
  const authorizeUrl = new URL('/auth/authorize', getOauthBaseUrl(oauthState))
  authorizeUrl.searchParams.set('client_id', oauthState.clientId)
  authorizeUrl.searchParams.set('redirect_uri', oauthState.redirectUri)
  authorizeUrl.searchParams.set('state', oauthState.state)
  return authorizeUrl.toString()
}

function buildTokenRequestBody(params: Record<string, string>) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    body.set(key, value)
  }
  return body
}

async function readTokenResponse(response: Response) {
  const payload = (await response.json()) as HomeAssistantTokenResponse | {
    error?: string
    error_description?: string
  }

  if (!response.ok) {
    const errorPayload =
      'access_token' in payload
        ? null
        : payload
    throw new Error(
      errorPayload?.error_description || errorPayload?.error || 'Home Assistant token request failed.',
    )
  }

  return payload as HomeAssistantTokenResponse
}

export async function exchangeAuthorizationCode(
  instanceUrl: string,
  clientId: string,
  code: string,
  externalUrl?: string | null,
) {
  const tokenUrl = new URL('/auth/token', externalUrl ?? instanceUrl)
  const response = await fetch(tokenUrl, {
    body: buildTokenRequestBody({
      client_id: clientId,
      code,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  })

  return readTokenResponse(response)
}

export async function refreshHomeAssistantAccessToken(
  instanceUrl: string,
  clientId: string,
  refreshToken: string,
) {
  const tokenUrl = new URL('/auth/token', instanceUrl)
  const response = await fetch(tokenUrl, {
    body: buildTokenRequestBody({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  })

  return readTokenResponse(response)
}
