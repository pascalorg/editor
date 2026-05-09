import { listImportableHomeAssistantResources } from '@pascal-app/home-assistant/server'
import {
  hasHomeAssistantServerConfig,
  resolveHomeAssistantServerConfig,
} from '@pascal-app/home-assistant/server'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const config = await resolveHomeAssistantServerConfig()
    if (!hasHomeAssistantServerConfig(config)) {
      return Response.json(
        {
          error: 'Home Assistant is not linked yet.',
          resources: [],
        },
        { status: 412 },
      )
    }

    const resources = await listImportableHomeAssistantResources(config)
    return Response.json({
      importedAt: new Date().toISOString(),
      resources,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Home Assistant import error.'
    return Response.json(
      {
        error: message,
        resources: [],
      },
      { status: 500 },
    )
  }
}
