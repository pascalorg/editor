import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  HOME_ASSISTANT_OAUTH_COOKIE,
  exchangeAuthorizationCode,
} from '../../../../_lib/home-assistant-auth'
import { writeLinkedHomeAssistantProfile } from '../../../../_lib/home-assistant-linked-profile'

export const runtime = 'nodejs'

function buildRedirectUrl(base: string, status: 'success' | 'error', message?: string) {
  const redirectUrl = new URL('/', base)
  redirectUrl.searchParams.set('ha_link', status)
  if (message) {
    redirectUrl.searchParams.set('ha_message', message)
  }
  return redirectUrl
}

export async function GET(request: NextRequest) {
  const oauthCookie = request.cookies.get(HOME_ASSISTANT_OAUTH_COOKIE)?.value
  const fallbackBase = request.nextUrl.origin

  if (!oauthCookie) {
    return NextResponse.redirect(
      buildRedirectUrl(fallbackBase, 'error', 'Missing Home Assistant OAuth state.'),
    )
  }

  try {
    const oauthState = JSON.parse(oauthCookie) as {
      clientId?: string
      externalUrl?: string | null
      instanceUrl?: string
      state?: string
    }
    const code = request.nextUrl.searchParams.get('code')
    const state = request.nextUrl.searchParams.get('state')

    if (!(oauthState.clientId && oauthState.instanceUrl && oauthState.state && code && state)) {
      throw new Error('Missing OAuth callback parameters.')
    }

    if (state !== oauthState.state) {
      throw new Error('Home Assistant OAuth state did not match.')
    }

    const tokens = await exchangeAuthorizationCode(
      oauthState.instanceUrl,
      oauthState.clientId,
      code,
      oauthState.externalUrl,
    )

    await writeLinkedHomeAssistantProfile({
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      clientId: oauthState.clientId,
      externalUrl:
        typeof oauthState.externalUrl === 'string' && oauthState.externalUrl.trim().length > 0
          ? oauthState.externalUrl
          : null,
      instanceUrl: oauthState.instanceUrl,
      linkedAt: new Date().toISOString(),
      refreshToken: tokens.refresh_token ?? '',
    })

    const response = NextResponse.redirect(buildRedirectUrl(oauthState.clientId, 'success'))
    response.cookies.delete(HOME_ASSISTANT_OAUTH_COOKIE)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete Home Assistant sign-in.'
    const parsedCookie = JSON.parse(oauthCookie) as { clientId?: string }
    const response = NextResponse.redirect(
      buildRedirectUrl(parsedCookie.clientId ?? fallbackBase, 'error', message),
    )
    response.cookies.delete(HOME_ASSISTANT_OAUTH_COOKIE)
    return response
  }
}
