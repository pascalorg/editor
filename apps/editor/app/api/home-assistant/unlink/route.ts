import { clearLinkedHomeAssistantProfile } from '@pascal-app/home-assistant/server'

export const runtime = 'nodejs'

export async function DELETE() {
  try {
    await clearLinkedHomeAssistantProfile()
    return Response.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to unlink Home Assistant.'
    return Response.json({ error: message, success: false }, { status: 500 })
  }
}
