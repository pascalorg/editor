import { clearLinkedHomeAssistantProfile } from '../../../_lib/home-assistant-linked-profile'

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
