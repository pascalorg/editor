import {
  resolveHomeAssistantServerConfig,
  validateHomeAssistantConnection,
} from '../../../_lib/home-assistant-server'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const result = await validateHomeAssistantConnection(await resolveHomeAssistantServerConfig())
    return Response.json(result, { status: result.success ? 200 : 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to connect to Home Assistant.'
    return Response.json(
      {
        baseUrl: null,
        castEntityId: null,
        castFriendlyName: null,
        clientId: null,
        entityCount: 0,
        error: message,
        externalUrl: null,
        instanceUrl: null,
        linked: false,
        message,
        mode: 'unlinked',
        success: false,
      },
      { status: 500 },
    )
  }
}
