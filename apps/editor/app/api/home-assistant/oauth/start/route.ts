import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  buildHomeAssistantAuthorizeUrl,
  buildHomeAssistantOauthState,
  HOME_ASSISTANT_OAUTH_COOKIE,
  normalizeOptionalHomeAssistantUrl,
} from '../../../../_lib/home-assistant-auth'

export const runtime = 'nodejs'

type StartOauthRequestBody = {
  externalUrl?: string
  instanceUrl?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StartOauthRequestBody
    const instanceUrl = normalizeOptionalHomeAssistantUrl(body.instanceUrl)
    const externalUrl = normalizeOptionalHomeAssistantUrl(body.externalUrl)
    const resolvedInstanceUrl = instanceUrl ?? externalUrl

    if (!resolvedInstanceUrl) {
      return Response.json(
        { error: 'A Home Assistant local or remote URL is required.' },
        { status: 400 },
      )
    }

    const oauthState = buildHomeAssistantOauthState(request, resolvedInstanceUrl, externalUrl)

    const response = NextResponse.json({
      authorizeUrl: buildHomeAssistantAuthorizeUrl(oauthState),
    })

    response.cookies.set(HOME_ASSISTANT_OAUTH_COOKIE, JSON.stringify(oauthState), {
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/',
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
    })

    return response
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to start Home Assistant sign-in.'
    return Response.json({ error: message }, { status: 500 })
  }
}
