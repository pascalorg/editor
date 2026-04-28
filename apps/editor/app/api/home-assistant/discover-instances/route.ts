import { discoverHomeAssistantInstances } from '../../../_lib/home-assistant-instance-discovery'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const instances = await discoverHomeAssistantInstances()
    return Response.json({
      instances,
      scannedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown Home Assistant discovery error.'

    return Response.json(
      {
        error: message,
        instances: [],
      },
      { status: 500 },
    )
  }
}
