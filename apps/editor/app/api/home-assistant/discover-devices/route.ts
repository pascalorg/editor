import { discoverHomeAssistantDevices } from '../../../_lib/home-assistant-discovery'
import {
  hasHomeAssistantServerConfig,
  resolveHomeAssistantServerConfig,
} from '../../../_lib/home-assistant-server'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const config = await resolveHomeAssistantServerConfig()
    if (!hasHomeAssistantServerConfig(config)) {
      return Response.json(
        {
          devices: [],
          error: 'Home Assistant is not linked yet.',
        },
        { status: 412 },
      )
    }

    const devices = await discoverHomeAssistantDevices(config)
    return Response.json({
      devices,
      scannedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Home Assistant discovery error.'
    return Response.json(
      {
        devices: [],
        error: message,
      },
      { status: 500 },
    )
  }
}
