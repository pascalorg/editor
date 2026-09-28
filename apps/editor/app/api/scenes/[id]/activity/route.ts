import { z } from 'zod'
import { forwardSceneAgentRequest } from '@/lib/scene-agent-server'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const controlSchema = z.object({
  action: z.enum(['pause', 'stop', 'resume']),
  runId: z.string().min(1).max(200),
})

export async function GET(request: Request, { params }: Context) {
  return forwardSceneAgentRequest(request, (await params).id, '')
}

export async function POST(request: Request, { params }: Context) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const parsed = controlSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  return forwardSceneAgentRequest(request, (await params).id, parsed.data.action, {
    runId: parsed.data.runId,
  })
}
