import { forwardSceneAgentRequest } from '@/lib/scene-agent-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardSceneAgentRequest(request, (await params).id, 'events')
}
