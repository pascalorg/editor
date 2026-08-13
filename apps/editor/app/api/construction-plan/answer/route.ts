import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { constructionQuestionHook } from '@/workflows/hooks/construction-question'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  sceneId: z.string().min(1).max(64),
  answer: z.string().min(1).max(2000),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

/** Resumes a paused `planConstructionPackage` run with the user's answer to the formwork question. */
export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    await constructionQuestionHook.resume(parsed.data.sceneId, { answer: parsed.data.answer })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return sceneApiJson(request, { error: 'resume_failed', details: message }, { status: 502 })
  }
}
